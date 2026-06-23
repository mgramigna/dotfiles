import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

const CUSTOM_STATE = "overseer-state";
const CUSTOM_REVIEW = "overseer-review";

const DEFAULT_DEBOUNCE_MS = 15_000;
const DEFAULT_MIN_REVIEW_INTERVAL_MS = 60_000;
const DEFAULT_MAX_DIFF_BYTES = 60_000;
const REVIEW_TIMEOUT_MS = 120_000;
const LOG_DIR = join(getAgentDir(), "logs");

const REVIEW_PROMPT = `You are \`overseer\`, a background code review agent for defensible technical findings.

Use epistemic discipline at all times. Your job is not to sound plausible.
Your job is to produce findings that can survive scrutiny.

You are reviewing the diff and context supplied by the caller. Do not look for a
different review target. Do not make edits.

Only report findings introduced or made relevant by the supplied diff. Do not
report pre-existing issues unless the diff makes them worse or newly reachable.
Prefer \`VERIFIED\` findings. Suppress weak \`HUNCH\` findings unless they point
to serious correctness, security, or data-loss risk.

Core standards:

1. Trace or delete.
   - Every finding must trace to code, logs, commands, or other direct evidence.
   - If you cannot show evidence, delete the claim or label it a \`HUNCH\` or \`QUESTION\`.

2. Facts, not assumptions.
   - Say what the code shows, not what you think it probably means.
   - Be concrete: exact paths, line numbers, conditions, branches, and data flow.

3. Label confidence.
   - \`VERIFIED\`: directly supported by evidence you traced.
   - \`HUNCH\`: pattern recognition or suspicion, not fully traced.
   - \`QUESTION\`: needs user input, runtime confirmation, or missing context.
   - Never present a \`HUNCH\` as a confirmed finding.

4. Falsify, don't confirm.
   - Try to prove yourself wrong before reporting a bug.
   - Ask: what would make this not a bug?
   - Check for guards, invariants, upstream validation, framework behavior, or other counter-evidence.

Quality criteria:

1. Proven correctness: did you verify behavior, or only inspect code?
2. Types tell the truth: do types and abstractions match reality?
3. Naming is honest: do names mislead future readers?
4. Edges tested: what happens on the unhappy path?
5. Self-consistent abstractions: can the full path be explained without contradiction?

Slop indicators:

- missing tests where risk is high
- contradictions in abstractions
- names that lie about behavior or contents
- pattern-match claims without direct evidence

Review heuristics:

- prioritize correctness, security, data loss, concurrency, auth, validation, and rollback risk
- prefer a few strong findings over many weak ones
- avoid style nits unless they hide a correctness or maintenance problem
- if no actionable issue is supported, say so plainly

Required report format:

\`\`\`markdown
## finding: <title>

**confidence:** VERIFIED | HUNCH | QUESTION
**location:** file:line
**evidence:** what the code actually shows
**falsification attempted:** what would disprove this, and whether you checked
\`\`\`

Output rules:

- Use the exact format above for each finding.
- Include line references whenever possible.
- Keep evidence specific and code-grounded.
- If there are no findings, say that you found no defensible issues.
- Do not emit XML.
- Do not make edits.`;

interface OverseerState {
	enabled: boolean;
	pendingFiles: Set<string>;
	reviewInFlight: boolean;
	reviewAgain: boolean;
	lastReviewAt: number;
	lastDiffHash?: string;
	timer?: ReturnType<typeof setTimeout>;
	cwd?: string;
}

const state: OverseerState = {
	enabled: false,
	pendingFiles: new Set(),
	reviewInFlight: false,
	reviewAgain: false,
	lastReviewAt: 0,
};

async function git(cwd: string, args: string[], maxBuffer = 20 * 1024 * 1024): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer, timeout: 30_000 });
	return stdout.trimEnd();
}

async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
	try {
		return await git(cwd, args);
	} catch {
		return null;
	}
}

function isProbablyMutatingShell(command: string): boolean {
	return /(^|[;&|]\s*)(mv|cp|rm|mkdir|touch|python3?|node|npm|pnpm|yarn|bun|make|sed|perl|ruby|go|cargo|git)\b/.test(command);
}

function shouldIgnorePath(file: string): boolean {
	return /(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo)\//.test(file)
		|| /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(file)
		|| /\.min\.(js|css)$/.test(file);
}

function addPendingFile(file: string): void {
	const normalized = file.trim();
	if (normalized && !shouldIgnorePath(normalized)) state.pendingFiles.add(normalized);
}

function hashText(text: string): string {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
	return (hash >>> 0).toString(16);
}

function truncateBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
	// Use a conservative char cap to avoid requiring Node type globals in this extension file.
	if (text.length <= maxBytes) return { text, truncated: false };
	return { text: text.slice(0, maxBytes), truncated: true };
}

function hasNoFindings(review: string): boolean {
	return !/## finding:/i.test(review) && /no defensible issues|no actionable issue|no findings/i.test(review);
}

function formatReviewForMainAgent(review: string, logPath?: string): string {
	return [
		"Overseer completed an async review of the recent edits.",
		"Address any VERIFIED findings before continuing. Treat HUNCH/QUESTION items as review leads, not facts.",
		logPath ? `Trace log: ${logPath}` : undefined,
		"",
		review.trim(),
	].filter((line): line is string => line !== undefined).join("\n");
}

function timestampForPath(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

async function createTraceLog(reason: string, files: string[], truncated: boolean): Promise<string> {
	await mkdir(LOG_DIR, { recursive: true });
	const logPath = join(LOG_DIR, `overseer-${timestampForPath()}.log`);
	await appendFile(
		logPath,
		[
			"# Overseer trace",
			`started: ${new Date().toISOString()}`,
			`reason: ${reason}`,
			`truncated: ${truncated}`,
			"files:",
			...files.map((file) => `- ${file}`),
			"",
		].join("\n"),
	);
	return logPath;
}

async function trace(logPath: string | undefined, message: string): Promise<void> {
	if (!logPath) return;
	await appendFile(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

async function collectDiff(cwd: string, files: string[]): Promise<{ diff: string; truncated: boolean }> {
	const args = ["diff", "--no-ext-diff", "--", ...files];
	const diff = await git(cwd, args, DEFAULT_MAX_DIFF_BYTES * 4);
	const truncatedDiff = truncateBytes(diff, DEFAULT_MAX_DIFF_BYTES);
	return { diff: truncatedDiff.text, truncated: truncatedDiff.truncated };
}

async function runReviewer(ctx: ExtensionContext, files: string[], diff: string, truncated: boolean, logPath?: string): Promise<string> {
	const loader = new DefaultResourceLoader({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: REVIEW_PROMPT,
	});
	await loader.reload();

	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(ctx.cwd),
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		tools: ["read", "grep", "find"],
	} as any);

	let output = "";
	const unsubscribe = session.subscribe((event: any) => {
		if (event.type === "tool_execution_start") {
			void trace(logPath, `tool start: ${event.toolName} ${JSON.stringify(event.args ?? {})}`);
		}
		if (event.type === "tool_execution_end") {
			void trace(logPath, `tool end: ${event.toolName} ${event.isError ? "error" : "ok"}`);
		}
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
			output += event.assistantMessageEvent.delta;
		}
		if (event.type === "agent_end") {
			void trace(logPath, "agent end");
		}
	});

	try {
		const prompt = [
			"Review the supplied uncommitted diff for defensible findings.",
			truncated ? `The diff was truncated to ${DEFAULT_MAX_DIFF_BYTES} bytes. Say if truncation prevents a defensible conclusion.` : undefined,
			"",
			"Changed files:",
			...files.map((file) => `- ${file}`),
			"",
			"Diff:",
			"```diff",
			diff,
			"```",
		]
			.filter((part): part is string => part !== undefined)
			.join("\n");

		await trace(logPath, `prompt chars: ${prompt.length}`);
		await Promise.race([
			session.prompt(prompt),
			new Promise((_, reject) => setTimeout(() => reject(new Error("overseer review timed out")), REVIEW_TIMEOUT_MS)),
		]);
		const trimmedOutput = output.trim();
		await trace(logPath, `review output chars: ${trimmedOutput.length}`);
		if (logPath) await appendFile(logPath, `\n## Reviewer output\n\n${trimmedOutput}\n`);
		return trimmedOutput;
	} finally {
		unsubscribe();
		session.dispose();
	}
}

function scheduleReview(pi: ExtensionAPI, ctx: ExtensionContext, reason: string): void {
	if (!state.enabled) return;
	if (state.timer) clearTimeout(state.timer);
	state.timer = setTimeout(() => void reviewNow(pi, ctx, reason), DEFAULT_DEBOUNCE_MS);
	ctx.ui.setStatus("overseer", `overseer: ${state.pendingFiles.size} pending`);
}

async function reviewNow(pi: ExtensionAPI, ctx: ExtensionContext, reason = "manual"): Promise<void> {
	if (!state.enabled) return;
	if (state.reviewInFlight) {
		state.reviewAgain = true;
		return;
	}

	const elapsed = Date.now() - state.lastReviewAt;
	if (reason !== "manual" && elapsed < DEFAULT_MIN_REVIEW_INTERVAL_MS) {
		state.timer = setTimeout(() => void reviewNow(pi, ctx, "rate-limit"), DEFAULT_MIN_REVIEW_INTERVAL_MS - elapsed);
		return;
	}

	const files = [...state.pendingFiles].filter(Boolean).sort();
	if (files.length === 0) return;

	state.reviewInFlight = true;
	state.reviewAgain = false;
	ctx.ui.setStatus("overseer", "overseer: reviewing");

	try {
		const { diff, truncated } = await collectDiff(ctx.cwd, files);
		if (!diff.trim()) {
			state.pendingFiles.clear();
			ctx.ui.setStatus("overseer", "overseer: enabled");
			return;
		}

		const diffHash = hashText(diff);
		if (diffHash === state.lastDiffHash) return;
		state.lastDiffHash = diffHash;
		state.lastReviewAt = Date.now();

		const logPath = await createTraceLog(reason, files, truncated);
		await trace(logPath, `diff hash: ${diffHash}`);
		await trace(logPath, `diff chars: ${diff.length}`);
		const review = await runReviewer(ctx, files, diff, truncated, logPath);
		if (!review || hasNoFindings(review)) {
			ctx.ui.notify(`Overseer found no defensible issues. Trace: ${logPath}`, "info");
			state.pendingFiles.clear();
			return;
		}

		pi.sendMessage(
			{
				customType: CUSTOM_REVIEW,
				content: formatReviewForMainAgent(review, logPath),
				display: true,
				details: { files, truncated, logPath },
			},
			{ deliverAs: "steer", triggerTurn: true },
		);
		state.pendingFiles.clear();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Overseer review failed: ${message}`, "error");
	} finally {
		state.reviewInFlight = false;
		ctx.ui.setStatus("overseer", state.enabled ? "overseer: enabled" : "");
		if (state.reviewAgain && state.pendingFiles.size > 0) scheduleReview(pi, ctx, "queued");
	}
}

function restoreState(ctx: ExtensionContext): void {
	let enabled = false;
	for (const entry of ctx.sessionManager.getEntries() as any[]) {
		if (entry.type === "custom" && entry.customType === CUSTOM_STATE && typeof entry.data?.enabled === "boolean") {
			enabled = entry.data.enabled;
		}
	}
	state.enabled = enabled;
	state.cwd = ctx.cwd;
	ctx.ui.setStatus("overseer", enabled ? "overseer: enabled" : "");
}

export default function (pi: ExtensionAPI) {
	pi.registerMessageRenderer(CUSTOM_REVIEW, (message: any, _options: any, theme: any) => {
		const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
		box.addChild(new Text(`${theme.fg("accent", "[overseer]")} ${String(message.content ?? "")}`, 0, 0));
		return box;
	});

	pi.on("session_start", async (_event: any, ctx: any) => {
		restoreState(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (state.timer) clearTimeout(state.timer);
		state.timer = undefined;
		state.reviewInFlight = false;
	});

	pi.on("tool_result", async (event: any, ctx: any) => {
		if (!state.enabled || event.isError) return;

		if ((event.toolName === "edit" || event.toolName === "write") && typeof event.input?.path === "string") {
			addPendingFile(event.input.path);
			scheduleReview(pi, ctx, event.toolName);
			return;
		}

		if (event.toolName === "bash" && typeof event.input?.command === "string" && isProbablyMutatingShell(event.input.command)) {
			const changed = await gitOrNull(ctx.cwd, ["diff", "--name-only"]);
			for (const file of changed?.split("\n") ?? []) addPendingFile(file);
			if (state.pendingFiles.size > 0) scheduleReview(pi, ctx, "bash");
		}
	});

	pi.registerCommand("overseer", {
		description: "Opt-in async code review for recent edits: enable, disable, status, review-now, clear",
		handler: async (args: string, ctx: any) => {
			const subcommand = args.trim() || "status";
			if (subcommand === "enable") {
				state.enabled = true;
				pi.appendEntry(CUSTOM_STATE, { enabled: true, at: Date.now() });
				ctx.ui.setStatus("overseer", "overseer: enabled");
				ctx.ui.notify("Overseer enabled for this session.", "info");
				return;
			}

			if (subcommand === "disable") {
				state.enabled = false;
				state.pendingFiles.clear();
				if (state.timer) clearTimeout(state.timer);
				state.timer = undefined;
				pi.appendEntry(CUSTOM_STATE, { enabled: false, at: Date.now() });
				ctx.ui.setStatus("overseer", "");
				ctx.ui.notify("Overseer disabled.", "info");
				return;
			}

			if (subcommand === "clear") {
				state.pendingFiles.clear();
				state.lastDiffHash = undefined;
				ctx.ui.notify("Overseer pending files cleared.", "info");
				return;
			}

			if (subcommand === "review-now") {
				if (state.pendingFiles.size === 0) {
					const changed = await gitOrNull(ctx.cwd, ["diff", "--name-only"]);
					for (const file of changed?.split("\n") ?? []) addPendingFile(file);
				}
				await reviewNow(pi, ctx, "manual");
				return;
			}

			const pending = [...state.pendingFiles].sort();
			ctx.ui.notify(
				[
					`Overseer is ${state.enabled ? "enabled" : "disabled"}.`,
					`Pending files: ${pending.length}`,
					pending.slice(0, 8).map((file) => `- ${file}`).join("\n"),
				]
					.filter(Boolean)
					.join("\n"),
				"info",
			);
		},
	});
}
