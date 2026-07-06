import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

const RUN_DIR = join(getAgentDir(), "overseer");
const CUSTOM_REVIEW_COMPLETE = "overseer-review-complete";
const REVIEW_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

const REVIEW_SYSTEM_PROMPT = `You are overseer, a read-only code review agent running beside a coding agent in a herdr pane.

Your job is to look over the shoulder of the implementation agent and produce defensible, evidence-backed review findings. Do not edit files.

Review standard:
- Only report issues introduced or made relevant by the supplied diff.
- Prefer correctness, security, data loss, concurrency, auth, validation, rollback, and test-risk findings.
- Avoid style nits unless they hide a correctness or maintainability problem.
- Falsify every finding before reporting it: look for guards, invariants, tests, framework behavior, and call-site constraints.
- If the evidence is weak, label it HUNCH or QUESTION instead of presenting it as fact.

Required format for each issue:

## finding: <title>

**confidence:** VERIFIED | HUNCH | QUESTION
**location:** file:line
**evidence:** what the code/diff actually shows
**falsification attempted:** what you checked that might have disproven it
**suggested fix:** concise remediation

If there are no defensible issues, say exactly: "I found no defensible issues."`;

const HELP = `Overseer commands:
- /overseer review            Run a headless sub-agent review of the current uncommitted diff.
- /overseer review --headed   Spawn a right-side herdr pane running a fresh pi review session. Requires HERDR_ENV=1.
- /overseer pane              Show the last recorded overseer pane id.
- /overseer read [n]          Read recent output from the overseer pane.
- /overseer help              Show this help.

By default, overseer runs headlessly as a sub-agent and returns a structured artifact for the main agent to inspect and act on. Use --headed when you explicitly want a visible herdr pane.`;

interface OverseerState {
	paneId?: string;
	promptPath?: string;
	startedAt?: number;
	monitorToken?: number;
}

const state: OverseerState = {};

async function execJson(command: string, args: string[], cwd?: string): Promise<any> {
	const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 2 * 1024 * 1024, timeout: 10_000 });
	return JSON.parse(stdout);
}

async function execText(command: string, args: string[], cwd?: string, timeout = 30_000): Promise<string> {
	const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout });
	return stdout.trimEnd();
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function modelArg(ctx: ExtensionContext): string | undefined {
	const model = (ctx as any).model;
	if (!model?.id) return undefined;
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

async function currentPaneId(cwd: string): Promise<string | undefined> {
	if (process.env.HERDR_ENV !== "1") return undefined;
	if (process.env.HERDR_PANE_ID) return process.env.HERDR_PANE_ID;
	const payload = await execJson("herdr", ["pane", "list"], cwd);
	return payload?.result?.panes?.find((pane: any) => pane.focused)?.pane_id;
}

async function splitRight(cwd: string): Promise<string> {
	const current = await currentPaneId(cwd);
	if (!current) throw new Error("Overseer requires HERDR_ENV=1 and a focused herdr pane.");
	const split = await execJson("herdr", ["pane", "split", current, "--direction", "right", "--no-focus"], cwd);
	const paneId = split?.result?.pane?.pane_id;
	if (typeof paneId !== "string") throw new Error("herdr did not return a new pane id.");
	return paneId;
}

async function git(cwd: string, args: string[]): Promise<string> {
	return execText("git", args, cwd);
}

async function gitOrEmpty(cwd: string, args: string[]): Promise<string> {
	try {
		return await git(cwd, args);
	} catch {
		return "";
	}
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

async function reviewPromptBody(ctx: ExtensionContext): Promise<string> {
	const changed = await gitOrEmpty(ctx.cwd, ["diff", "--name-only"]);
	const stat = await gitOrEmpty(ctx.cwd, ["diff", "--stat"]);
	const diff = await gitOrEmpty(ctx.cwd, ["diff", "--no-ext-diff"]);
	return [
		"# Overseer review request",
		"",
		`Working directory: ${ctx.cwd}`,
		"",
		"Review the uncommitted diff below. You may inspect repository files to verify or falsify findings, but do not edit anything.",
		"",
		"## Changed files",
		changed.trim() ? changed.split("\n").map((file) => `- ${file}`).join("\n") : "No changed files were reported by git diff --name-only.",
		"",
		"## Diff stat",
		"```",
		stat || "(empty)",
		"```",
		"",
		"## Diff",
		"```diff",
		diff || "(empty)",
		"```",
		"",
	].join("\n");
}

async function writeReviewPrompt(ctx: ExtensionContext): Promise<string> {
	await mkdir(RUN_DIR, { recursive: true });
	const promptPath = join(RUN_DIR, `review-${timestamp()}.md`);
	await writeFile(promptPath, await reviewPromptBody(ctx), "utf8");
	return promptPath;
}

function confidenceCounts(text: string) {
	return {
		verified: [...text.matchAll(/confidence(?:\*\*)?\s*:\s*VERIFIED\b/gi)].length,
		hunch: [...text.matchAll(/confidence(?:\*\*)?\s*:\s*HUNCH\b/gi)].length,
		question: [...text.matchAll(/confidence(?:\*\*)?\s*:\s*QUESTION\b/gi)].length,
	};
}

async function runHeadlessReview(ctx: ExtensionContext, artifactPath?: string) {
	await mkdir(RUN_DIR, { recursive: true });
	const promptPath = join(RUN_DIR, `review-${timestamp()}.md`);
	await writeFile(promptPath, await reviewPromptBody(ctx), "utf8");
	const selectedModel = modelArg(ctx);
	const args = ["-p", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"];
	if (selectedModel) args.push("--model", selectedModel);
	args.push("--name", "overseer review", "--system-prompt", REVIEW_SYSTEM_PROMPT, `@${promptPath}`);
	const output = await execText("pi", args, ctx.cwd, REVIEW_WAIT_TIMEOUT_MS);
	const findings = extractReviewFindings(output);
	const counts = confidenceCounts(findings);
	const artifact = {
		version: 1,
		cwd: ctx.cwd,
		promptPath,
		createdAt: new Date().toISOString(),
		status: counts.verified > 0 ? "needs_resolution" : "passed",
		counts,
		findings,
		output,
	};
	const path = artifactPath || join(RUN_DIR, `artifact-${timestamp()}.json`);
	await writeFile(path, JSON.stringify(artifact, null, 2) + "\n", "utf8");
	return { path, artifact };
}

async function spawnReviewPane(ctx: ExtensionContext): Promise<OverseerState> {
	const promptPath = await writeReviewPrompt(ctx);
	const paneId = await splitRight(ctx.cwd);
	const selectedModel = modelArg(ctx);
	const modelFlag = selectedModel ? ` --model ${shellQuote(selectedModel)}` : "";
	const command = [
		"cd " + shellQuote(ctx.cwd),
		"printf '%s\\n' '[overseer] starting pi review session...'",
		`pi --no-skills --no-prompt-templates --no-themes --no-context-files${modelFlag} --name ${shellQuote("overseer review")} --system-prompt ${shellQuote(REVIEW_SYSTEM_PROMPT)} @${shellQuote(promptPath)}`,
	].join(" && ");
	await execFileAsync("herdr", ["pane", "run", paneId, command], { cwd: ctx.cwd, timeout: 10_000 });
	state.paneId = paneId;
	state.promptPath = promptPath;
	state.startedAt = Date.now();
	state.monitorToken = Date.now();
	return { ...state };
}

async function readPane(cwd: string, paneId: string, lines = "120"): Promise<string> {
	return execText("herdr", ["pane", "read", paneId, "--source", "recent", "--lines", lines], cwd, 10_000);
}

async function waitForReviewerDone(cwd: string, paneId: string): Promise<void> {
	await execFileAsync("herdr", ["wait", "agent-status", paneId, "--status", "done", "--timeout", String(REVIEW_WAIT_TIMEOUT_MS)], {
		cwd,
		timeout: REVIEW_WAIT_TIMEOUT_MS + 5_000,
	});
}

const FINDING_CONFIDENCE_RE = /(?:^|\n)\s*(?:\*\*)?confidence(?:\*\*)?\s*:\s*(VERIFIED|HUNCH|QUESTION)\b/i;
const FINDING_HEADING_RE = /(?:^|\n)\s*(?:##\s*)?finding\s*:/i;

function hasFindingConfidence(text: string): boolean {
	return FINDING_CONFIDENCE_RE.test(text);
}

function extractReviewFindings(output: string): string {
	const trimmed = output.trim();
	if (!trimmed) return "";

	const headingMatches = [...trimmed.matchAll(new RegExp(FINDING_HEADING_RE.source, "gi"))];
	const findingSections = headingMatches
		.map((match, index) => {
			const start = match.index ?? 0;
			const end = headingMatches[index + 1]?.index ?? trimmed.length;
			return trimmed.slice(start, end).trim();
		})
		.filter(hasFindingConfidence);

	if (findingSections.length > 0) return findingSections.join("\n\n");

	return hasFindingConfidence(trimmed) ? trimmed : "";
}

function reviewCompleteMessage(paneId: string, promptPath: string | undefined, output: string): string {
	const findings = extractReviewFindings(output);
	const noFindings = findings.length === 0;
	const result = noFindings ? "No VERIFIED, HUNCH, or QUESTION findings were found in the overseer output." : findings;
	return [
		`Overseer review completed in herdr pane ${paneId}.`,
		promptPath ? `Review prompt: ${promptPath}` : undefined,
		"",
		"IMPORTANT: You must respond to the user so they know you saw this review. Do not silently continue or sit idle.",
		noFindings
			? "The reviewer appears to have found no defensible issues. If you agree, explicitly say that you saw the overseer review and no action is needed."
			: "Inspect these findings and decide how to respond. If you make no changes, explicitly explain why. Treat HUNCH/QUESTION items as leads, not facts.",
		"",
		"Overseer result:",
		"```",
		result,
		"```",
	].filter((line): line is string => line !== undefined).join("\n");
}

function setOverseerStatus(ctx: ExtensionContext, text: string): void {
	ctx.ui.setStatus("overseer", ctx.ui.theme.fg("dim", text));
}

function monitorReviewer(pi: ExtensionAPI, ctx: ExtensionContext, paneId: string, promptPath: string | undefined, token: number): void {
	void (async () => {
		try {
			await waitForReviewerDone(ctx.cwd, paneId);
			if (state.monitorToken !== token || state.paneId !== paneId) return;
			const output = await readPane(ctx.cwd, paneId, "200");
			setOverseerStatus(ctx, "overseer: done");
			ctx.ui.notify(`Overseer review completed in pane ${paneId}. Notifying the main agent.`, "info");
			const message = reviewCompleteMessage(paneId, promptPath, output);
			pi.sendMessage(
				{
					customType: CUSTOM_REVIEW_COMPLETE,
					content: message,
					display: true,
					details: { paneId, promptPath },
				},
				{ deliverAs: "nextTurn" },
			);
			pi.sendUserMessage(message, { deliverAs: "followUp" });
		} catch (error) {
			if (state.monitorToken !== token || state.paneId !== paneId) return;
			const message = error instanceof Error ? error.message : String(error);
			setOverseerStatus(ctx, "overseer: error");
			ctx.ui.notify(`Overseer monitor stopped for pane ${paneId}: ${message}`, "warning");
		}
	})();
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
		setOverseerStatus(ctx, state.paneId ? "overseer: reviewing" : "overseer: ready");
	});

	pi.on("session_shutdown", async () => {
		// The reviewer pane is intentionally left running; it is a visible, independent pi session.
	});

	pi.registerTool({
		name: "overseer_review",
		label: "Overseer review",
		description: "Run headless overseer review for the current uncommitted diff and persist a structured artifact.",
		parameters: Type.Object({
			artifactPath: Type.Optional(Type.String({ description: "Path to write review artifact JSON. Defaults under ~/.pi/agent/overseer." })),
		}),
		async execute(_toolCallId: string, params: { artifactPath?: string }, _signal: any, _onUpdate: unknown, ctx: ExtensionContext) {
			const { path, artifact } = await runHeadlessReview(ctx, params.artifactPath);
			const summary = artifact.findings || "I found no defensible issues.";
			return {
				content: [{ type: "text", text: `Overseer review ${artifact.status}. Artifact: ${path}\n\n${summary}` }],
				details: { path, status: artifact.status, counts: artifact.counts, findings: artifact.findings },
			};
		},
	});

	pi.registerTool({
		name: "overseer_read_pane",
		label: "Read overseer pane",
		description: "Read recent output from the latest herdr pane spawned by /overseer review.",
		parameters: Type.Object({
			lines: Type.Optional(Type.String({ description: "Number of recent lines to read. Defaults to 120." })),
		}),
		async execute(_toolCallId: string, params: { lines?: string }, _signal: any, _onUpdate: unknown, ctx: ExtensionContext) {
			if (!state.paneId) {
				return { content: [{ type: "text", text: "No overseer pane has been spawned in this session." }], details: {} };
			}
			const output = await readPane(ctx.cwd, state.paneId, params.lines ?? "120");
			return { content: [{ type: "text", text: output || `(pane ${state.paneId} had no recent output)` }], details: { ...state } };
		},
	});

	pi.registerCommand("overseer", {
		description: "Overseer adversarial review: review [--headed], pane, read, help",
		handler: async (args: string, ctx: ExtensionContext) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const command = tokens[0]?.startsWith("--") ? "review" : tokens[0] || "review";
			const commandArgs = tokens[0]?.startsWith("--") ? tokens : tokens.slice(1);
			const flags = new Set(commandArgs.filter((token) => token.startsWith("--")));
			const maybeLines = commandArgs.find((token) => !token.startsWith("--"));

			if (command === "help" || command === "--help" || command === "-h") {
				ctx.ui.notify(HELP, "info");
				return;
			}

			if (command === "pane" || command === "status") {
				ctx.ui.notify(state.paneId ? `Overseer pane: ${state.paneId}\nPrompt: ${state.promptPath}` : "No overseer pane has been spawned yet.", "info");
				return;
			}

			if (command === "read") {
				if (!state.paneId) {
					ctx.ui.notify("No overseer pane has been spawned yet.", "info");
					return;
				}
				const output = await readPane(ctx.cwd, state.paneId, maybeLines || "120");
				ctx.ui.notify(`Overseer pane ${state.paneId}:\n\n${output}`, "info");
				return;
			}

			if (command !== "review") {
				ctx.ui.notify(HELP, "warning");
				return;
			}

			if (flags.has("--headed")) {
				setOverseerStatus(ctx, "overseer: spawning");
				try {
					const spawned = await spawnReviewPane(ctx);
					setOverseerStatus(ctx, "overseer: reviewing");
					if (spawned.paneId && spawned.monitorToken) monitorReviewer(pi, ctx, spawned.paneId, spawned.promptPath, spawned.monitorToken);
					ctx.ui.notify(`Overseer review spawned in herdr pane ${spawned.paneId}.\nPrompt: ${spawned.promptPath}\nThe main agent will be notified when the reviewer finishes. Use /overseer read or the overseer_read_pane tool to inspect output sooner.`, "info");
				} catch (error) {
					setOverseerStatus(ctx, "overseer: error");
					ctx.ui.notify(`Could not spawn overseer review: ${error instanceof Error ? error.message : String(error)}`, "error");
					throw error;
				}
				return;
			}

			try {
				setOverseerStatus(ctx, "overseer: reviewing");
				const { path, artifact } = await runHeadlessReview(ctx);
				setOverseerStatus(ctx, artifact.status === "passed" ? "overseer: passed" : "overseer: needs resolution");
				const summary = artifact.findings || "I found no defensible issues.";
				ctx.ui.notify(`Overseer review ${artifact.status}.\nArtifact: ${path}\n\n${summary}`, artifact.status === "passed" ? "info" : "warning");
			} catch (error) {
				setOverseerStatus(ctx, "overseer: error");
				ctx.ui.notify(`Could not run overseer review: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
