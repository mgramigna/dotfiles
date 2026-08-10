import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getPreferredModel } from "../shared/model-prefs";

const execFileAsync = promisify(execFile);
const MAX_DIFF_CHARS = 60_000;

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
	return stdout;
}

async function getCommitContext(cwd: string): Promise<{ status: string; diff: string; source: "staged" | "unstaged" }> {
	await git(["rev-parse", "--show-toplevel"], cwd);
	const status = await git(["status", "--short"], cwd);
	if (!status.trim()) throw new Error("No git changes found.");

	const staged = await git(["diff", "--cached", "--stat"], cwd);
	const hasStaged = staged.trim().length > 0;
	const diffArgs = hasStaged ? ["diff", "--cached"] : ["diff"];
	let diff = await git(diffArgs, cwd);

	if (!diff.trim()) {
		// Covers newly-created untracked files. Conventional commit generation can still use status.
		diff = "(No textual diff available; use git status below. This usually means only untracked files or binary files changed.)";
	}

	if (diff.length > MAX_DIFF_CHARS) {
		diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS.toLocaleString()} characters]`;
	}

	return { status, diff, source: hasStaged ? "staged" : "unstaged" };
}

function buildPrompt(status: string, diff: string, source: "staged" | "unstaged"): string {
	return `Generate a git commit message for the ${source} changes below.

Requirements:
- Use the Conventional Commits standard: type(scope): description
- Pick the most accurate type, usually feat, fix, docs, style, refactor, perf, test, build, ci, chore, or revert.
- Use a scope only when it is clear and useful.
- Subject must be imperative, concise, lowercase unless a proper noun requires capitalization, and <= 72 characters.
- If useful, include a short body after a blank line with bullet points. Omit the body for simple changes.
- Return only the commit message text, with no markdown fences or commentary.

Git status:
${status}

Git diff:
${diff}`;
}

function extractText(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

async function copyToClipboard(text: string): Promise<boolean> {
	const commands: Array<{ command: string; args: string[] }> = [
		{ command: "pbcopy", args: [] },
		{ command: "wl-copy", args: [] },
		{ command: "xclip", args: ["-selection", "clipboard"] },
	];

	for (const { command, args } of commands) {
		try {
			const child = execFile(command, args);
			child.stdin?.end(text);
			await new Promise<void>((resolve, reject) => {
				child.on("error", reject);
				child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
			});
			return true;
		} catch {
			// Try the next platform clipboard helper.
		}
	}

	return false;
}

async function generateCommitMessage(ctx: ExtensionCommandContext): Promise<string> {
	const preferred = await getPreferredModel(ctx, "small");
	if (!preferred) throw new Error("No configured 'small' model preference. Run /model-prefs setup small first.");

	const { status, diff, source } = await getCommitContext(ctx.cwd);
	ctx.ui.notify(`Generating commit message from ${source} changes with ${preferred.provider}/${preferred.modelId}...`, "info");

	const response = await complete(
		preferred.model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: buildPrompt(status, diff, source) }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: preferred.auth.apiKey,
			headers: preferred.auth.headers,
			reasoningEffort: preferred.reasoningEffort,
		},
	);

	const message = extractText(response.content);
	if (!message) throw new Error("The model returned an empty commit message.");
	return message;
}

async function handleCommitMessage(_args: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const generated = await generateCommitMessage(ctx);
		const finalMessage = ctx.hasUI ? await ctx.ui.editor("Generated commit message", generated) : generated;
		if (!finalMessage?.trim()) {
			ctx.ui.notify("Commit message discarded.", "warning");
			return;
		}

		const copied = await copyToClipboard(finalMessage.trim());
		ctx.ui.notify(copied ? "Commit message copied to clipboard." : finalMessage.trim(), copied ? "info" : "warning");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Commit message generation failed: ${message}`, "error");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("commit-message", {
		description: "Generate a Conventional Commit message using the shared small model",
		handler: handleCommitMessage,
	});

	pi.registerCommand("cm", {
		description: "Alias for /commit-message",
		handler: handleCommitMessage,
	});
}
