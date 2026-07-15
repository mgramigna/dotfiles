import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { getAgentDir, type AgentToolResult, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { autocompleteSelect } from "./autocomplete-select";

const execFileAsync = promisify(execFile);

const RUN_DIR = join(getAgentDir(), "overseer");
const REVIEW_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const COMPACT_REVIEW_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const EMPTY_DIFF_MESSAGE = "There is nothing for overseer to review in the selected git diff. Make a change first, then run /overseer review again.";
const EMPTY_PR_DIFF_MESSAGE = "There is nothing for overseer to review in the selected pull request diff.";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type OverseerThinkingLevel = (typeof THINKING_LEVELS)[number];

type OverseerConfig = {
	model?: string;
	thinking?: OverseerThinkingLevel;
};

const defaultOverseerConfig: OverseerConfig = {};

const REVIEW_SYSTEM_PROMPT = `You are overseer, a read-only adversarial code review agent running as a headless subprocess.

Your job is to look over the shoulder of the implementation agent and produce defensible, evidence-backed review findings. Do not edit files.

Adversarial stance:
- Assume the changed code is wrong until the code, tests, types, framework behavior, or explicit invariants prove it correct.
- Treat happy-path reasoning as insufficient; actively look for edge cases, missing guards, invalid states, races, rollback gaps, and unsafe assumptions.
- Challenge names, comments, and apparent intent. Trust only executable behavior and verified constraints.
- Try to construct realistic failure scenarios from the supplied diff, then inspect the repository to prove or disprove them.

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
- /overseer review            Ask the agent to run the overseer_review tool for all local changes: staged, unstaged, and untracked files.
- /overseer review --pr <url|number>
                           Ask the agent to run the overseer_review tool for a GitHub pull request diff fetched with gh.
- /overseer status            Show the latest overseer run status, artifact path, log path, and tail command.
- /overseer doctor            Check overseer setup and config.
- /overseer setup             Interactively create an overseer config if one does not exist.
- /overseer help              Show this help.

By default, overseer runs headlessly as a sub-agent and returns a structured artifact for the main agent to inspect and act on.`;

interface OverseerState {
	firstRunGuidanceShown?: boolean;
}

const state: OverseerState = {};

async function execText(command: string, args: string[], cwd?: string, timeout = 30_000, signal?: AbortSignal): Promise<string> {
	const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout, signal });
	return stdout.trimEnd();
}

async function execTextStreaming(command: string, args: string[], options: { cwd?: string; timeout: number; signal?: AbortSignal; logPath: string }): Promise<{ stdout: string; stderr: string }> {
	await appendFile(options.logPath, `$ ${[command, ...args].join(" ")}\n\n`);
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let settled = false;
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, options.timeout);
		const abort = () => child.kill("SIGTERM");
		options.signal?.addEventListener("abort", abort, { once: true });

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
			void appendFile(options.logPath, chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
			void appendFile(options.logPath, chunk);
		});
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abort);
			reject(error);
		});
		child.on("close", (code, childSignal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abort);
			const stdout = Buffer.concat(stdoutChunks).toString("utf8").trimEnd();
			const stderr = Buffer.concat(stderrChunks).toString("utf8").trimEnd();
			if (code === 0) return resolve({ stdout, stderr });
			const error = new Error(timedOut ? `Command timed out after ${Math.round(options.timeout / 1000)}s` : `Command failed with exit code ${code ?? `signal ${childSignal}`}`) as Error & { code?: string | number; killed?: boolean; signal?: string | null; stdout?: string; stderr?: string };
			error.code = timedOut ? "ETIMEDOUT" : code ?? undefined;
			error.killed = timedOut;
			error.signal = childSignal;
			error.stdout = stdout;
			error.stderr = stderr;
			reject(error);
		});
	});
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

type ReviewDiff = {
	kind: "diff";
	changed: string;
	stat: string;
	diff: string;
};

type ReviewPullRequest = {
	kind: "pull_request";
	ref: string;
	url?: string;
	title?: string;
	baseRefName?: string;
	headRefName?: string;
	changed: string;
	stat: string;
	diff: string;
};

type ReviewSubject = ReviewDiff | ReviewPullRequest;

async function execTextAllowExit(command: string, args: string[], cwd?: string, timeout = 30_000): Promise<string> {
	try {
		return await execText(command, args, cwd, timeout);
	} catch (error) {
		const execError = error as Error & { stdout?: string };
		return execError.stdout?.trimEnd() ?? "";
	}
}

async function untrackedFiles(cwd: string): Promise<string[]> {
	const output = await gitOrEmpty(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
	return output.split("\0").filter(Boolean);
}

async function untrackedFileDiff(cwd: string, file: string): Promise<string> {
	return execTextAllowExit("git", ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", file], cwd);
}

async function currentReviewDiff(cwd: string): Promise<ReviewDiff> {
	const [trackedChanged, trackedStat, trackedDiff, untracked] = await Promise.all([
		gitOrEmpty(cwd, ["diff", "HEAD", "--name-only"]),
		gitOrEmpty(cwd, ["diff", "HEAD", "--stat"]),
		gitOrEmpty(cwd, ["diff", "HEAD", "--no-ext-diff"]),
		untrackedFiles(cwd),
	]);
	const untrackedDiffs = await Promise.all(untracked.map((file) => untrackedFileDiff(cwd, file)));
	const changed = [...trackedChanged.split("\n").filter(Boolean), ...untracked].join("\n");
	const untrackedStat = untracked.length ? `Untracked files:\n${untracked.map((file) => ` ${file}`).join("\n")}` : "";
	const stat = [trackedStat, untrackedStat].filter(Boolean).join("\n\n");
	const diff = [trackedDiff, ...untrackedDiffs].filter(Boolean).join("\n\n");
	return { kind: "diff", changed, stat, diff };
}

function hasReviewableDiff(reviewSubject: ReviewSubject): boolean {
	return reviewSubject.diff.trim().length > 0;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

async function reviewPromptBody(ctx: ExtensionContext, reviewSubject?: ReviewSubject): Promise<string> {
	const subject = reviewSubject ?? (await currentReviewDiff(ctx.cwd));
	const { changed, stat, diff } = subject;
	return [
		"# Overseer review request",
		"",
		`Working directory: ${ctx.cwd}`,
		reviewSubjectLabel(subject),
		"",
		subject.kind === "pull_request"
			? "Review the GitHub pull request diff below. You may inspect repository files to verify or falsify findings, but do not edit anything."
			: "Review the selected uncommitted diff below. You may inspect repository files to verify or falsify findings, but do not edit anything.",
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

function reviewSubjectLabel(subject: ReviewSubject): string {
	if (subject.kind === "pull_request") {
		const title = subject.title ? ` (${subject.title})` : "";
		const refs = subject.baseRefName && subject.headRefName ? ` ${subject.baseRefName}...${subject.headRefName}` : "";
		return `Pull request: ${subject.url ?? subject.ref}${title}${refs}`;
	}
	return "Diff scope: all local changes (tracked staged, tracked unstaged, and untracked files)";
}

type ReviewStatus = "passed" | "has_questions" | "needs_resolution";
type ReviewDecision = "approve" | "request_changes" | "non_blocking_comments";

const CONFIDENCE_LINE_RE = /(?:^|\n)\s*(?:\*\*)?confidence\s*:\s*(?:\*\*)?\s*(VERIFIED|HUNCH|QUESTION)\b/gi;

function confidenceCounts(text: string) {
	const counts = { verified: 0, hunch: 0, question: 0 };
	for (const match of text.matchAll(CONFIDENCE_LINE_RE)) {
		const confidence = match[1]?.toLowerCase();
		if (confidence === "verified") counts.verified += 1;
		if (confidence === "hunch") counts.hunch += 1;
		if (confidence === "question") counts.question += 1;
	}
	return counts;
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

function decisionFromCounts(counts: ReturnType<typeof confidenceCounts>): ReviewDecision {
	if (counts.verified > 0) return "request_changes";
	if (counts.hunch > 0 || counts.question > 0) return "non_blocking_comments";
	return "approve";
}

function summaryFromDecision(decision: ReviewDecision, counts: ReturnType<typeof confidenceCounts>): string {
	if (decision === "approve") return "No defensible issues found.";
	const parts = [
		counts.verified ? `${counts.verified} VERIFIED` : undefined,
		counts.hunch ? `${counts.hunch} HUNCH` : undefined,
		counts.question ? `${counts.question} QUESTION` : undefined,
	].filter((part): part is string => Boolean(part));
	return `Overseer found ${parts.join(", ")} finding${counts.verified + counts.hunch + counts.question === 1 ? "" : "s"}. Full review is available in the artifact.`;
}

async function pullRequestReviewDiff(cwd: string, ref: string): Promise<ReviewPullRequest> {
	const [viewRaw, diff] = await Promise.all([
		execText("gh", ["pr", "view", ref, "--json", "url,title,baseRefName,headRefName,files"], cwd, 30_000),
		execText("gh", ["pr", "diff", ref], cwd, 30_000),
	]);
	const metadata = JSON.parse(viewRaw) as any;
	const fileEntries = Array.isArray(metadata.files) ? metadata.files : [];
	const files = fileEntries.map((file: any) => file.path).filter((path: unknown): path is string => typeof path === "string");
	const stat = fileEntries.length
		? fileEntries.map((file: any) => {
			const path = typeof file.path === "string" ? file.path : "(unknown)";
			const additions = typeof file.additions === "number" ? file.additions : 0;
			const deletions = typeof file.deletions === "number" ? file.deletions : 0;
			return `${path} | +${additions} -${deletions}`;
		}).join("\n")
		: "(gh pr view reported no file metadata)";
	return {
		kind: "pull_request",
		ref,
		url: typeof metadata.url === "string" ? metadata.url : undefined,
		title: typeof metadata.title === "string" ? metadata.title : undefined,
		baseRefName: typeof metadata.baseRefName === "string" ? metadata.baseRefName : undefined,
		headRefName: typeof metadata.headRefName === "string" ? metadata.headRefName : undefined,
		changed: files.join("\n"),
		stat,
		diff,
	};
}

async function runHeadlessReview(ctx: ExtensionContext, artifactPath?: string, reviewSubject?: ReviewSubject, timeoutMs = REVIEW_WAIT_TIMEOUT_MS, signal?: AbortSignal) {
	const selectedDiff = reviewSubject ?? (await currentReviewDiff(ctx.cwd));
	if (!hasReviewableDiff(selectedDiff)) return { skipped: true as const, message: selectedDiff.kind === "pull_request" ? EMPTY_PR_DIFF_MESSAGE : EMPTY_DIFF_MESSAGE };
	await mkdir(RUN_DIR, { recursive: true });
	const runTimestamp = timestamp();
	const promptPath = join(RUN_DIR, `review-${runTimestamp}.md`);
	const path = artifactPath || join(RUN_DIR, `artifact-${runTimestamp}.json`);
	const logPath = join(RUN_DIR, `run-${runTimestamp}.log`);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(promptPath, await reviewPromptBody(ctx, selectedDiff), "utf8");
	await writeFile(logPath, `Overseer review started at ${new Date().toISOString()}\nArtifact: ${path}\nPrompt: ${promptPath}\n\n`, "utf8");
	const startedAt = new Date().toISOString();
	const startedArtifact = {
		version: 1,
		cwd: ctx.cwd,
		subject: selectedDiff.kind === "pull_request" ? { kind: selectedDiff.kind, ref: selectedDiff.ref, url: selectedDiff.url } : { kind: selectedDiff.kind },
		promptPath,
		logPath,
		createdAt: startedAt,
		status: "running",
		summary: `Overseer review is still running. Started at ${startedAt}.`,
	};
	await writeFile(path, JSON.stringify(startedArtifact, null, 2) + "\n", "utf8");
	const config = await loadOverseerConfig(ctx);
	const args = ["-p", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"];
	args.push(...piConfigArgs(ctx, config));
	args.push("--name", "overseer review", "--system-prompt", REVIEW_SYSTEM_PROMPT, `@${promptPath}`);
	let output: string;
	try {
		const result = await execTextStreaming("pi", args, { cwd: ctx.cwd, timeout: timeoutMs, signal, logPath });
		output = result.stdout;
	} catch (error) {
		const execError = error as Error & { code?: string | number; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
		const timedOut = execError.killed || execError.signal === "SIGTERM" || execError.code === "ETIMEDOUT";
		const message = timedOut
			? `Overseer review timed out after ${Math.round(timeoutMs / 1000)}s.`
			: `Overseer review failed: ${execError.message}`;
		const failedArtifact = {
			...startedArtifact,
			status: timedOut ? "timed_out" : "failed",
			summary: message,
			completedAt: new Date().toISOString(),
			error: execError.message,
			stderr: execError.stderr,
			stdout: execError.stdout,
		};
		await writeFile(path, JSON.stringify(failedArtifact, null, 2) + "\n", "utf8");
		throw new Error(`${message} Artifact: ${path} Log: ${logPath}${execError.stderr ? `\n\n${execError.stderr.trim()}` : ""}`);
	}
	const findings = extractReviewFindings(output);
	const counts = confidenceCounts(findings);
	const status = reviewStatusFromCounts(counts);
	const decision = decisionFromCounts(counts);
	const artifact = {
		version: 1,
		cwd: ctx.cwd,
		subject: selectedDiff.kind === "pull_request" ? { kind: selectedDiff.kind, ref: selectedDiff.ref, url: selectedDiff.url } : { kind: selectedDiff.kind },
		promptPath,
		logPath,
		createdAt: startedAt,
		completedAt: new Date().toISOString(),
		status,
		decision,
		summary: summaryFromDecision(decision, counts),
		counts,
		findings,
		output,
	};
	await writeFile(path, JSON.stringify(artifact, null, 2) + "\n", "utf8");
	return { skipped: false as const, path, artifact };
}

const FINDING_CONFIDENCE_RE = /(?:^|\n)\s*(?:\*\*)?confidence\s*:\s*(?:\*\*)?\s*(VERIFIED|HUNCH|QUESTION)\b/i;
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

async function latestArtifactPath(): Promise<string | undefined> {
	try {
		const entries = await readdir(RUN_DIR);
		const artifacts = await Promise.all(entries
			.filter((entry) => entry.startsWith("artifact-") && entry.endsWith(".json"))
			.map(async (entry) => {
				const path = join(RUN_DIR, entry);
				const info = await stat(path);
				return { path, mtimeMs: info.mtimeMs };
			}));
		return artifacts.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function runStatus(): Promise<string> {
	const artifactPath = await latestArtifactPath();
	if (!artifactPath) return `No overseer artifacts found in ${RUN_DIR}.`;
	const raw = await readFile(artifactPath, "utf8");
	const artifact = JSON.parse(raw) as { status?: string; decision?: string; summary?: string; createdAt?: string; completedAt?: string; promptPath?: string; logPath?: string };
	const lines = [
		"overseer status",
		`status: ${artifact.status ?? "unknown"}`,
		...(artifact.decision ? [`decision: ${artifact.decision}`] : []),
		...(artifact.summary ? [`summary: ${artifact.summary}`] : []),
		...(artifact.createdAt ? [`created: ${artifact.createdAt}`] : []),
		...(artifact.completedAt ? [`completed: ${artifact.completedAt}`] : []),
		`artifact: ${artifactPath}`,
		...(artifact.promptPath ? [`prompt: ${artifact.promptPath}`] : []),
		...(artifact.logPath ? [`log: ${artifact.logPath}`, `tail: tail -f ${JSON.stringify(artifact.logPath)}`] : ["log: not recorded for this artifact"]),
	];
	return lines.join("\n");
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

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
		if (!state.firstRunGuidanceShown && !(await hasAnyOverseerConfig(ctx))) {
			state.firstRunGuidanceShown = true;
			ctx.ui.notify("Welcome to overseer! Run /overseer setup to choose review defaults, or try /overseer review anytime to review your current diff.", "info");
		}
	});


	pi.registerTool({
		name: "overseer_review",
		label: "Overseer review",
		description: "Run headless overseer review for all local changes by default, or for a GitHub PR, and persist a structured artifact.",
		parameters: Type.Object({
			artifactPath: Type.Optional(Type.String({ description: "Path to write review artifact JSON. Defaults under ~/.pi/agent/overseer." })),
			pr: Type.Optional(Type.String({ description: "GitHub PR URL or number to review with gh pr diff instead of local changes." })),
		}),
		async execute(_toolCallId: string, params: { artifactPath?: string; pr?: string }, signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext): Promise<AgentToolResult<unknown>> {
			const subject = params.pr ? await pullRequestReviewDiff(ctx.cwd, params.pr) : undefined;
			const result = await runHeadlessReview(ctx, params.artifactPath, subject, REVIEW_WAIT_TIMEOUT_MS, signal);
			if (result.skipped) {
				return {
					content: [{ type: "text", text: result.message }],
					details: { status: "skipped", reason: "empty_current_git_diff" },
				};
			}
			const { path, artifact } = result;
			const summary = artifact.findings || "I found no defensible issues.";
			return {
				content: [{ type: "text", text: `Overseer review ${friendlyReviewStatus(artifact.status)}. Artifact: ${path}\nLog: ${artifact.logPath}\n\n${summary}` }],
				details: { path, logPath: artifact.logPath, status: artifact.status, counts: artifact.counts, findings: artifact.findings },
			};
		},
	});

	pi.registerTool({
		name: "overseer_request_review",
		label: "Request overseer review",
		description: "Ask overseer for a compact approve/request_changes/non_blocking_comments review decision without returning full findings.",
		parameters: Type.Object({
			pr: Type.Optional(Type.String({ description: "GitHub PR URL or number to review with gh pr diff instead of local changes." })),
			artifactPath: Type.Optional(Type.String({ description: "Path to write review artifact JSON. Defaults under ~/.pi/agent/overseer." })),
		}),
		async execute(_toolCallId: string, params: { pr?: string; artifactPath?: string }, signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext): Promise<AgentToolResult<unknown>> {
			const reviewDiff = params.pr ? await pullRequestReviewDiff(ctx.cwd, params.pr) : await currentReviewDiff(ctx.cwd);
			const result = await runHeadlessReview(ctx, params.artifactPath, reviewDiff, COMPACT_REVIEW_WAIT_TIMEOUT_MS, signal);
			if (result.skipped) {
				return {
					content: [{ type: "text", text: result.message }],
					details: { status: "skipped", reason: "empty_current_git_diff" },
				};
			}
			const { path, artifact } = result;
			return {
				content: [{ type: "text", text: `Overseer decision: ${artifact.decision}\nArtifact: ${path}\nLog: ${artifact.logPath}\nSummary: ${artifact.summary}` }],
				details: {
					artifactPath: path,
					logPath: artifact.logPath,
					decision: artifact.decision,
					status: artifact.status,
					counts: artifact.counts,
					summary: artifact.summary,
				},
			};
		},
	});

	pi.registerTool({
		name: "overseer_read_review",
		label: "Read overseer review",
		description: "Read a persisted overseer review artifact, defaulting to compact summary details.",
		parameters: Type.Object({
			artifactPath: Type.String({ description: "Path to an overseer artifact JSON file." }),
			detailLevel: Type.Optional(Type.Union([
				Type.Literal("summary"),
				Type.Literal("findings"),
				Type.Literal("raw"),
			], { description: "Amount of review detail to return. Defaults to summary." })),
		}),
		async execute(_toolCallId: string, params: { artifactPath: string; detailLevel?: "summary" | "findings" | "raw" }): Promise<AgentToolResult<unknown>> {
			const raw = await readFile(params.artifactPath, "utf8");
			const artifact = JSON.parse(raw) as {
				decision?: ReviewDecision;
				status?: ReviewStatus;
				counts?: ReturnType<typeof confidenceCounts>;
				summary?: string;
				findings?: string;
				output?: string;
			};
			const detailLevel = params.detailLevel ?? "summary";
			const summary = artifact.summary ?? "No summary was recorded in this overseer artifact.";
			const header = `Overseer decision: ${artifact.decision ?? "unknown"}\nStatus: ${artifact.status ?? "unknown"}\nSummary: ${summary}`;
			const body = detailLevel === "raw"
				? artifact.output || "No raw output was recorded in this overseer artifact."
				: detailLevel === "findings"
					? artifact.findings || "I found no defensible issues."
					: "";
			return {
				content: [{ type: "text", text: body ? `${header}\n\n${body}` : header }],
				details: {
					artifactPath: params.artifactPath,
					decision: artifact.decision,
					status: artifact.status,
					counts: artifact.counts,
					summary,
				},
			};
		},
	});

	pi.registerCommand("overseer", {
		description: "Overseer adversarial review: review [--pr <url|number>], status, doctor, setup, help",
		getArgumentCompletions(prefix: string) {
			const items = [
				{ value: "review", label: "review", description: "Review all local changes, including untracked files" },
				{ value: "review --pr ", label: "review --pr", description: "Review a GitHub PR with gh" },
				{ value: "status", label: "status", description: "Show latest overseer run status and log path" },
				{ value: "doctor", label: "doctor", description: "Check overseer setup" },
				{ value: "setup", label: "setup", description: "Configure overseer" },
				{ value: "help", label: "help", description: "Show help" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: string, ctx: ExtensionContext) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const command = tokens[0]?.startsWith("--") ? "review" : tokens[0] || "review";
			const commandArgs = tokens[0]?.startsWith("--") ? tokens : tokens.slice(1);
			if (command === "help" || command === "--help" || command === "-h") {
				ctx.ui.notify(HELP, "info");
				return;
			}


			if (command === "status") {
				ctx.ui.notify(await runStatus(), "info");
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


			if (command !== "review") {
				ctx.ui.notify(HELP, "warning");
				return;
			}

			const prFlagIndex = commandArgs.findIndex((token) => token === "--pr" || token === "--github-pr");
			const prRef = prFlagIndex >= 0 ? commandArgs[prFlagIndex + 1] : commandArgs.find((token) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(token));
			const params = prRef ? ` with { "pr": ${JSON.stringify(prRef)} }` : " for the current local changes";
			pi.sendUserMessage(`Run the overseer_review tool${params}. Do not perform any other work before calling the tool.`, { deliverAs: "followUp" });
		},
	});
}
