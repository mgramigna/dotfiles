import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { getAgentDir, type AgentToolResult, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { autocompleteSelect } from "./autocomplete-select";

const execFileAsync = promisify(execFile);

const RUN_DIR = join(getAgentDir(), "overseer");
const CUSTOM_REVIEW_COMPLETE = "overseer-review-complete";
const REVIEW_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const EMPTY_DIFF_MESSAGE = "There is nothing for overseer to review in the selected git diff. Make a change first, then run /overseer review again.";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type OverseerThinkingLevel = (typeof THINKING_LEVELS)[number];

type OverseerConfig = {
	model?: string;
	thinking?: OverseerThinkingLevel;
};

const defaultOverseerConfig: OverseerConfig = {};

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
- /overseer review            Run a headless sub-agent review of unstaged changes (git diff).
- /overseer review --staged   Review staged changes (git diff --cached). Alias: --cached.
- /overseer review --all      Review unstaged plus staged changes (git diff HEAD).
- /overseer review --pane / --headed
                           Spawn a right-side herdr pane running a fresh pi review session. Requires running inside herdr.
                           Combine with --staged/--cached or --all to choose the diff scope.
- /overseer pane              Show the last recorded overseer pane id.
- /overseer read [n]          Read recent output from the overseer pane.
- /overseer doctor            Check overseer setup and config.
- /overseer setup             Interactively create an overseer config if one does not exist.
- /overseer help              Show this help.

By default, overseer runs headlessly as a sub-agent and returns a structured artifact for the main agent to inspect and act on. Use --pane / --headed when you explicitly want a visible herdr pane.`;

interface OverseerState {
	paneId?: string;
	promptPath?: string;
	startedAt?: number;
	monitorToken?: number;
	firstRunGuidanceShown?: boolean;
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

function getConfigPath(cwd: string): string {
	return join(cwd, ".pi", "overseer.json");
}

function getGlobalConfigPath(): string {
	return join(getAgentDir(), "overseer.json");
}

function getConfigDir(path: string): string {
	return dirname(path);
}

function isProjectTrusted(ctx: ExtensionContext): boolean {
	return (ctx as any).isProjectTrusted?.() ?? true;
}

async function loadOverseerConfig(ctx: ExtensionContext): Promise<OverseerConfig> {
	const globalConfig = await loadOptionalConfig(getGlobalConfigPath());
	const projectConfig = isProjectTrusted(ctx) ? await loadOptionalConfig(getConfigPath(ctx.cwd)) : undefined;
	return { ...defaultOverseerConfig, ...globalConfig, ...projectConfig };
}

async function hasAnyOverseerConfig(ctx: ExtensionContext): Promise<boolean> {
	if (await configExists(getGlobalConfigPath())) return true;
	return isProjectTrusted(ctx) ? configExists(getConfigPath(ctx.cwd)) : false;
}

async function configExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function loadOptionalConfig(path: string): Promise<OverseerConfig | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}

	return parseOverseerConfig(JSON.parse(raw));
}

function parseOverseerConfig(value: unknown): OverseerConfig {
	if (!isRecord(value)) throw new Error("overseer config must be an object");
	const model = parseOptionalString(value.model, "model");
	const thinking = parseOptionalThinkingLevel(value.thinking);
	return {
		...(model !== undefined ? { model } : {}),
		...(thinking !== undefined ? { thinking } : {}),
	};
}

function parseOptionalString(value: unknown, key: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim()) throw new Error(`overseer config ${key} must be a non-empty string`);
	return value;
}

function parseOptionalThinkingLevel(value: unknown): OverseerThinkingLevel | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !THINKING_LEVELS.includes(value as OverseerThinkingLevel)) {
		throw new Error(`overseer config thinking must be one of: ${THINKING_LEVELS.join(", ")}`);
	}
	return value as OverseerThinkingLevel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelArg(ctx: ExtensionContext, config: OverseerConfig): string | undefined {
	if (config.model) return config.model;
	const model = (ctx as any).model;
	if (!model?.id) return undefined;
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

function piConfigArgs(ctx: ExtensionContext, config: OverseerConfig): string[] {
	const args: string[] = [];
	const selectedModel = modelArg(ctx, config);
	if (selectedModel) args.push("--model", selectedModel);
	if (config.thinking) args.push("--thinking", config.thinking);
	return args;
}

function piConfigFlags(ctx: ExtensionContext, config: OverseerConfig): string {
	return piConfigArgs(ctx, config).map(shellQuote).join(" ");
}

async function currentPaneId(cwd: string): Promise<string | undefined> {
	if (process.env.HERDR_ENV !== "1") return undefined;
	if (process.env.HERDR_PANE_ID) return process.env.HERDR_PANE_ID;
	const payload = await execJson("herdr", ["pane", "list"], cwd);
	return payload?.result?.panes?.find((pane: any) => pane.focused)?.pane_id;
}

async function splitRight(cwd: string): Promise<string> {
	const current = await currentPaneId(cwd);
	if (!current) throw new Error("Visible overseer pane reviews require running pi inside herdr with a focused pane. Start pi from herdr, or omit --pane/--headed to run a headless review.");
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

type ReviewDiffMode = "unstaged" | "staged" | "all";

type ReviewDiff = {
	mode: ReviewDiffMode;
	changed: string;
	stat: string;
	diff: string;
};

function gitDiffArgs(mode: ReviewDiffMode, extraArgs: string[] = []): string[] {
	const scopeArgs = mode === "staged" ? ["--cached"] : mode === "all" ? ["HEAD"] : [];
	return ["diff", ...scopeArgs, ...extraArgs];
}

async function currentReviewDiff(cwd: string, mode: ReviewDiffMode = "unstaged"): Promise<ReviewDiff> {
	const [changed, stat, diff] = await Promise.all([
		gitOrEmpty(cwd, gitDiffArgs(mode, ["--name-only"])),
		gitOrEmpty(cwd, gitDiffArgs(mode, ["--stat"])),
		gitOrEmpty(cwd, gitDiffArgs(mode, ["--no-ext-diff"])),
	]);
	return { mode, changed, stat, diff };
}

function hasReviewableDiff(reviewDiff: ReviewDiff): boolean {
	return reviewDiff.diff.trim().length > 0;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

async function reviewPromptBody(ctx: ExtensionContext, reviewDiff?: ReviewDiff): Promise<string> {
	const { changed, stat, diff } = reviewDiff ?? (await currentReviewDiff(ctx.cwd));
	return [
		"# Overseer review request",
		"",
		`Working directory: ${ctx.cwd}`,
		`Diff scope: ${changedDiffScopeLabel(reviewDiff?.mode ?? "unstaged")}`,
		"",
		"Review the selected uncommitted diff below. You may inspect repository files to verify or falsify findings, but do not edit anything.",
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

async function writeReviewPrompt(ctx: ExtensionContext, reviewDiff?: ReviewDiff): Promise<string> {
	await mkdir(RUN_DIR, { recursive: true });
	const promptPath = join(RUN_DIR, `review-${timestamp()}.md`);
	await writeFile(promptPath, await reviewPromptBody(ctx, reviewDiff), "utf8");
	return promptPath;
}

function changedDiffScopeLabel(mode: ReviewDiffMode): string {
	if (mode === "staged") return "staged changes (git diff --cached)";
	if (mode === "all") return "unstaged plus staged changes (git diff HEAD)";
	return "unstaged changes (git diff)";
}

function reviewDiffModeFromFlags(flags: Set<string>): ReviewDiffMode {
	if (flags.has("--all")) return "all";
	if (flags.has("--staged") || flags.has("--cached")) return "staged";
	return "unstaged";
}

type ReviewStatus = "passed" | "has_questions" | "needs_resolution";

function confidenceCounts(text: string) {
	return {
		verified: [...text.matchAll(/confidence(?:\*\*)?\s*:\s*VERIFIED\b/gi)].length,
		hunch: [...text.matchAll(/confidence(?:\*\*)?\s*:\s*HUNCH\b/gi)].length,
		question: [...text.matchAll(/confidence(?:\*\*)?\s*:\s*QUESTION\b/gi)].length,
	};
}

function reviewStatusFromCounts(counts: ReturnType<typeof confidenceCounts>): ReviewStatus {
	if (counts.verified > 0) return "needs_resolution";
	if (counts.hunch > 0 || counts.question > 0) return "has_questions";
	return "passed";
}

function friendlyReviewStatus(status: ReviewStatus): string {
	if (status === "needs_resolution") return "needs resolution";
	if (status === "has_questions") return "has questions";
	return "passed";
}

function reviewNotifyLevel(status: ReviewStatus): "info" | "warning" {
	return status === "passed" ? "info" : "warning";
}

async function runHeadlessReview(ctx: ExtensionContext, artifactPath?: string, reviewDiff?: ReviewDiff) {
	const selectedDiff = reviewDiff ?? (await currentReviewDiff(ctx.cwd));
	if (!hasReviewableDiff(selectedDiff)) return { skipped: true as const, message: EMPTY_DIFF_MESSAGE };
	await mkdir(RUN_DIR, { recursive: true });
	const promptPath = join(RUN_DIR, `review-${timestamp()}.md`);
	await writeFile(promptPath, await reviewPromptBody(ctx, selectedDiff), "utf8");
	const config = await loadOverseerConfig(ctx);
	const args = ["-p", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"];
	args.push(...piConfigArgs(ctx, config));
	args.push("--name", "overseer review", "--system-prompt", REVIEW_SYSTEM_PROMPT, `@${promptPath}`);
	const output = await execText("pi", args, ctx.cwd, REVIEW_WAIT_TIMEOUT_MS);
	const findings = extractReviewFindings(output);
	const counts = confidenceCounts(findings);
	const artifact = {
		version: 1,
		cwd: ctx.cwd,
		diffMode: selectedDiff.mode,
		promptPath,
		createdAt: new Date().toISOString(),
		status: reviewStatusFromCounts(counts),
		counts,
		findings,
		output,
	};
	const path = artifactPath || join(RUN_DIR, `artifact-${timestamp()}.json`);
	await writeFile(path, JSON.stringify(artifact, null, 2) + "\n", "utf8");
	return { skipped: false as const, path, artifact };
}

async function spawnReviewPane(ctx: ExtensionContext, reviewDiff?: ReviewDiff): Promise<OverseerState> {
	const selectedDiff = reviewDiff ?? (await currentReviewDiff(ctx.cwd));
	if (!hasReviewableDiff(selectedDiff)) throw new Error(EMPTY_DIFF_MESSAGE);
	const promptPath = await writeReviewPrompt(ctx, selectedDiff);
	const paneId = await splitRight(ctx.cwd);
	const config = await loadOverseerConfig(ctx);
	const configFlags = piConfigFlags(ctx, config);
	const command = [
		"cd " + shellQuote(ctx.cwd),
		"printf '%s\\n' '[overseer] starting pi review session...'",
		`pi --no-skills --no-prompt-templates --no-themes --no-context-files${configFlags ? ` ${configFlags}` : ""} --name ${shellQuote("overseer review")} --system-prompt ${shellQuote(REVIEW_SYSTEM_PROMPT)} @${shellQuote(promptPath)}`,
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

function reviewCompleteResult(output: string): { findings: string; counts: ReturnType<typeof confidenceCounts>; status: ReviewStatus } {
	const findings = extractReviewFindings(output);
	const counts = confidenceCounts(findings);
	return { findings, counts, status: reviewStatusFromCounts(counts) };
}

function reviewCompleteMessage(paneId: string, promptPath: string | undefined, output: string): string {
	const { findings, status } = reviewCompleteResult(output);
	const noFindings = findings.length === 0;
	const result = noFindings ? "No VERIFIED, HUNCH, or QUESTION findings were found in the overseer output." : findings;
	return [
		`Overseer review completed in herdr pane ${paneId}: ${friendlyReviewStatus(status)}.`,
		promptPath ? `Review prompt: ${promptPath}` : undefined,
		"",
		"IMPORTANT: You must respond to the user so they know you saw this review. Do not silently continue or sit idle.",
		status === "passed"
			? "The reviewer appears to have found no defensible issues. If you agree, explicitly say that you saw the overseer review and no action is needed."
			: status === "has_questions"
				? "Inspect these HUNCH/QUESTION findings and decide how to respond. If you make no changes, explicitly explain why. Treat them as leads, not facts."
				: "Inspect these VERIFIED findings and decide how to respond. If you make no changes, explicitly explain why.",
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

async function doctorCheck(name: string, check: () => Promise<void>): Promise<string> {
	try {
		await check();
		return `ok ${name}`;
	} catch (error) {
		const message = error instanceof Error ? error.message.trim() : String(error);
		return `fail ${name}: ${message.split("\n")[0] ?? message}`;
	}
}

async function runDoctor(ctx: ExtensionContext): Promise<string> {
	const trusted = isProjectTrusted(ctx);
	const checks: string[] = [];
	checks.push(await doctorCheck("git repo", async () => {
		await execText("git", ["rev-parse", "--show-toplevel"], ctx.cwd, 10_000);
	}));
	checks.push(await doctorCheck("pi", async () => {
		await execText("pi", ["--help"], ctx.cwd, 10_000);
	}));
	checks.push(trusted ? "ok project trusted" : "warn project not trusted; project .pi/overseer.json ignored");
	const globalPath = getGlobalConfigPath();
	const projectPath = getConfigPath(ctx.cwd);
	const globalExists = await configExists(globalPath);
	const projectExists = trusted ? await configExists(projectPath) : false;

	checks.push(globalExists
		? await doctorCheck(`global config ${globalPath}`, async () => {
			await loadOptionalConfig(globalPath);
		})
		: `warn global config not found ${globalPath}`);
	checks.push(!trusted
		? `warn project config ignored ${projectPath}`
		: projectExists
			? await doctorCheck(`project config ${projectPath}`, async () => {
				await loadOptionalConfig(projectPath);
			})
			: `ok no project config ${projectPath}`);

	const config = await loadOverseerConfig(ctx).catch(() => undefined);
	if (config) {
		const sources = ["defaults", globalExists ? "global" : undefined, projectExists ? "project" : undefined]
			.filter((source): source is string => Boolean(source));
		checks.push(`ok config sources ${sources.join(" + ")}`);
		checks.push(config.model ? `ok model ${config.model}` : `ok model ${modelArg(ctx, config) ?? "default"}`);
		checks.push(config.thinking ? `ok thinking ${config.thinking}` : "ok thinking default");
	}

	return ["overseer doctor", ...checks].join("\n");
}

async function readConfigObjectIfExists(path: string): Promise<Record<string, unknown> | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	const parsed = JSON.parse(raw);
	if (!isRecord(parsed)) throw new Error(`overseer config at ${path} must be an object`);
	parseOverseerConfig(parsed);
	return parsed;
}

function formatJsonDiff(before: string, after: string): string {
	const beforeLines = before.split("\n");
	const afterLines = after.split("\n");
	return [
		"Config diff:",
		...beforeLines.filter((line) => line.length > 0).map((line) => `- ${line}`),
		...afterLines.filter((line) => line.length > 0).map((line) => `+ ${line}`),
	].join("\n");
}

async function listAvailableModels(cwd: string): Promise<string[]> {
	const output = await execText("pi", ["--list-models"], cwd, 30_000);
	return output.split("\n").slice(1).map((line) => {
		const [provider, model] = line.trim().split(/\s+/);
		return provider && model ? `${provider}/${model}` : undefined;
	}).filter((model): model is string => Boolean(model));
}

async function runSetup(ctx: ExtensionContext): Promise<string> {
	const select = (ctx.ui as any).select as ((title: string, choices: string[]) => Promise<string | undefined>) | undefined;
	const input = (ctx.ui as any).input as ((prompt: string, placeholder?: string) => Promise<string | undefined>) | undefined;
	const confirm = (ctx.ui as any).confirm as ((title: string, message: string) => Promise<boolean>) | undefined;
	if (!select) return "Overseer setup requires a UI select prompt, but this Pi build does not expose one.";
	if (!confirm) return "Overseer setup requires a UI confirm prompt, but this Pi build does not expose one.";

	const projectPath = getConfigPath(ctx.cwd);
	const globalPath = getGlobalConfigPath();
	const scopeChoices = [
		`Global (${globalPath})`,
		`Project (${projectPath})`,
		"Cancel",
	];
	const scope = await select("Create overseer config", scopeChoices);
	if (!scope || scope === "Cancel") return "Overseer setup cancelled.";
	if (scope.startsWith("Project") && !isProjectTrusted(ctx)) return "Project is not trusted; refusing to write project .pi/overseer.json.";

	const path = scope.startsWith("Global") ? globalPath : projectPath;
	const existingConfig = await readConfigObjectIfExists(path);

	const currentModel = modelArg(ctx, defaultOverseerConfig);
	const models = await listAvailableModels(ctx.cwd);
	const modelChoices = [
		...(currentModel ? [`Use current model (${currentModel})`] : []),
		...models,
		"Enter manually",
		"Cancel",
	];
	const modelChoice = await autocompleteSelect(ctx, {
		title: "Overseer model",
		items: modelChoices.map((choice) => ({ value: choice, label: choice })),
		maxVisible: 12,
		noMatchText: "  No matching models",
	});
	if (!modelChoice || modelChoice === "Cancel") return "Overseer setup cancelled.";

	let model: string | undefined;
	if (modelChoice === "Enter manually") {
		if (!input) return "Manual model entry requires a UI input prompt, but this Pi build does not expose one.";
		model = (await input("Overseer model", "provider/model-id"))?.trim();
		if (!model) return "Overseer setup cancelled.";
	} else if (modelChoice.startsWith("Use current model (")) {
		model = currentModel;
	} else {
		model = modelChoice;
	}

	const thinkingChoice = await autocompleteSelect(ctx, {
		title: "Overseer thinking level",
		items: ["Default", ...THINKING_LEVELS, "Cancel"].map((choice) => ({ value: choice, label: choice })),
		maxVisible: THINKING_LEVELS.length + 2,
	});
	if (!thinkingChoice || thinkingChoice === "Cancel") return "Overseer setup cancelled.";
	const thinking = thinkingChoice === "Default" ? undefined : parseOptionalThinkingLevel(thinkingChoice);
	const config: OverseerConfig = {
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
	};
	const nextConfig = { ...(existingConfig ?? {}), ...config };
	const before = existingConfig ? JSON.stringify(existingConfig, null, 2) + "\n" : "";
	const after = JSON.stringify(nextConfig, null, 2) + "\n";
	if (before === after) return `Overseer config at ${path} already matches setup selections; no changes made.`;
	const ok = await confirm(
		existingConfig ? "Update overseer config?" : "Create overseer config?",
		`Path: ${path}\n\n${formatJsonDiff(before, after)}`,
	);
	if (!ok) return "Overseer setup cancelled; no changes made.";

	await mkdir(getConfigDir(path), { recursive: true });
	await writeFile(path, after, "utf8");
	return `${existingConfig ? "Updated" : "Created"} overseer config at ${path}.`;
}

function monitorReviewer(pi: ExtensionAPI, ctx: ExtensionContext, paneId: string, promptPath: string | undefined, token: number): void {
	void (async () => {
		try {
			await waitForReviewerDone(ctx.cwd, paneId);
			if (state.monitorToken !== token || state.paneId !== paneId) return;
			const output = await readPane(ctx.cwd, paneId, "200");
			const reviewResult = reviewCompleteResult(output);
			setOverseerStatus(ctx, `overseer: ${friendlyReviewStatus(reviewResult.status)}`);
			ctx.ui.notify(`Overseer review completed in pane ${paneId}: ${friendlyReviewStatus(reviewResult.status)}. Notifying the main agent.`, reviewNotifyLevel(reviewResult.status));
			const message = reviewCompleteMessage(paneId, promptPath, output);
			pi.sendMessage(
				{
					customType: CUSTOM_REVIEW_COMPLETE,
					content: message,
					display: true,
					details: { paneId, promptPath, status: reviewResult.status, counts: reviewResult.counts, findings: reviewResult.findings },
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
		if (!state.firstRunGuidanceShown && !(await hasAnyOverseerConfig(ctx))) {
			state.firstRunGuidanceShown = true;
			ctx.ui.notify("Welcome to overseer! Run /overseer setup to choose review defaults, or try /overseer review anytime to review your current diff.", "info");
		}
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
		async execute(_toolCallId: string, params: { artifactPath?: string }, _signal: any, _onUpdate: unknown, ctx: ExtensionContext): Promise<AgentToolResult<unknown>> {
			const result = await runHeadlessReview(ctx, params.artifactPath);
			if (result.skipped) {
				return {
					content: [{ type: "text", text: result.message }],
					details: { status: "skipped", reason: "empty_current_git_diff" },
				};
			}
			const { path, artifact } = result;
			const summary = artifact.findings || "I found no defensible issues.";
			return {
				content: [{ type: "text", text: `Overseer review ${friendlyReviewStatus(artifact.status)}. Artifact: ${path}\n\n${summary}` }],
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
		description: "Overseer adversarial review: review [--pane/--headed] [--staged|--cached|--all], pane, read, doctor, setup, help",
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

			if (command === "doctor") {
				ctx.ui.notify(await runDoctor(ctx), "info");
				return;
			}

			if (command === "setup") {
				ctx.ui.notify(await runSetup(ctx), "info");
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

			const reviewDiffMode = reviewDiffModeFromFlags(flags);
			const reviewDiff = await currentReviewDiff(ctx.cwd, reviewDiffMode);
			if (!hasReviewableDiff(reviewDiff)) {
				setOverseerStatus(ctx, "overseer: ready");
				ctx.ui.notify(EMPTY_DIFF_MESSAGE, "info");
				return;
			}

			if (flags.has("--pane") || flags.has("--headed")) {
				setOverseerStatus(ctx, "overseer: spawning");
				try {
					const spawned = await spawnReviewPane(ctx, reviewDiff);
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
				const result = await runHeadlessReview(ctx, undefined, reviewDiff);
				if (result.skipped) {
					setOverseerStatus(ctx, "overseer: ready");
					ctx.ui.notify(result.message, "info");
					return;
				}
				const { path, artifact } = result;
				setOverseerStatus(ctx, `overseer: ${friendlyReviewStatus(artifact.status)}`);
				const summary = artifact.findings || "I found no defensible issues.";
				ctx.ui.notify(`Overseer review ${friendlyReviewStatus(artifact.status)}.\nArtifact: ${path}\n\n${summary}`, reviewNotifyLevel(artifact.status));
			} catch (error) {
				setOverseerStatus(ctx, "overseer: error");
				ctx.ui.notify(`Could not run overseer review: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
