import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, stripFrontmatter, type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const SELECTION = "sketch:selection";
const HELP = "/sketch [instructions] | finalize [instructions] | save | open | implement | help";

type MapKind = "finalized" | "snapshot";
type PendingFinalization = { prompt: string; started: boolean; sessionId: string; repository: Repository };
type Repository = { root: string; branch: string | null; commit: string | null; directory: string };

async function git(cwd: string, ...args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, timeout: 5_000 });
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

async function repository(cwd: string): Promise<Repository> {
	const root = await realpath(await git(cwd, "rev-parse", "--show-toplevel") ?? cwd);
	const [branch, commit] = await Promise.all([
		git(root, "symbolic-ref", "--short", "HEAD"),
		git(root, "rev-parse", "HEAD"),
	]);
	const key = `${slug(basename(root))}-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`;
	return { root, branch, commit, directory: join(getAgentDir(), "handoffs", key) };
}

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "sketch";
}

function messageText(message: { content: string | Array<{ type: string; text?: string }> }): string {
	if (typeof message.content === "string") return message.content;
	return message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}

function completedAssistant(entry: SessionEntry | undefined): entry is SessionEntry & { type: "message"; message: AssistantMessage } {
	return entry?.type === "message" && entry.message.role === "assistant"
		&& entry.message.stopReason === "stop" && !entry.message.content.some((part) => part.type === "toolCall")
		&& messageText(entry.message).trim().length > 0;
}

function latestAssistant(branch: SessionEntry[]): SessionEntry | undefined {
	return branch.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
}

function updateStatus(ctx: ExtensionContext, ready: boolean) {
	ctx.ui.setStatus("sketch", ready ? ctx.ui.theme.fg("dim", "📝 sketch: ready") : undefined);
}

function selectedMap(ctx: ExtensionContext): string | undefined {
	const entry = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "custom" && entry.customType === SELECTION);
	if (entry?.type !== "custom" || typeof entry.data !== "object" || entry.data === null) return;
	const path = (entry.data as { path?: unknown }).path;
	return typeof path === "string" ? path : undefined;
}

async function promptFile(name: string, instructions: string): Promise<string> {
	const template = await readFile(new URL(name, import.meta.url), "utf8");
	return stripFrontmatter(template).replaceAll("${@:-none}", () => instructions.trim() || "none");
}

export default function (pi: ExtensionAPI) {
	let pending: PendingFinalization | undefined;

	function select(path: string, ctx: ExtensionContext) {
		pi.appendEntry(SELECTION, { path });
		updateStatus(ctx, true);
	}

	async function save(entry: SessionEntry, kind: MapKind, repo: Repository, ctx: ExtensionContext) {
		if (!completedAssistant(entry)) throw new Error("No completed assistant response to save.");
		const body = messageText(entry.message);
		const title = body.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "") ?? "sketch";
		const created = new Date().toISOString();
		const path = join(repo.directory, `${created.replace(/[:.]/g, "-")}-${slug(title)}-${randomUUID().slice(0, 8)}.md`);
		const metadata = {
			kind, created, repository: repo.root, branch: repo.branch, commit: repo.commit,
			sourceSession: ctx.sessionManager.getSessionFile() ?? null, sourceEntry: entry.id,
		};
		const header = Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
		await mkdir(repo.directory, { recursive: true, mode: 0o700 });
		await writeFile(path, `---\n${header}\n---\n\n${body}`, { flag: "wx", mode: 0o600 });
		select(path, ctx);
		ctx.ui.notify(`Saved ${kind} sketch: ${path}\nSaving does not mark it approved.`, "info");
	}

	pi.on("session_start", (_event, ctx) => {
		pending = undefined;
		const path = selectedMap(ctx);
		updateStatus(ctx, Boolean(path));
	});

	pi.on("before_agent_start", (event) => {
		if (!pending) return;
		if (event.prompt !== pending.prompt) pending = undefined;
		else pending.started = true;
	});

	// Wait through retries and queued work. The unique request must still be the
	// latest user message, so steering or unrelated follow-ups cannot be saved.
	pi.on("agent_settled", async (_event, ctx) => {
		const request = pending;
		pending = undefined;
		if (!request?.started || request.sessionId !== ctx.sessionManager.getSessionId()) return;
		const branch = ctx.sessionManager.getBranch();
		const userIndex = branch.findLastIndex((entry) => entry.type === "message" && entry.message.role === "user");
		const user = branch[userIndex];
		const subsequent = branch.slice(userIndex + 1);
		const response = latestAssistant(subsequent);
		const redirected = subsequent.some((entry) => entry.type === "custom_message");
		if (redirected || user?.type !== "message" || user.message.role !== "user" || messageText(user.message) !== request.prompt || !completedAssistant(response)) {
			ctx.ui.notify("Finalization was interrupted or changed; no map saved. Run /sketch finalize again.", "warning");
			return;
		}
		try {
			await save(response, "finalized", request.repository, ctx);
		} catch (error) {
			ctx.ui.notify(`Could not save sketch: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	});

	pi.registerCommand("sketch", {
		description: "Map an implementation, save decisions, or hand off to a fresh session",
		getArgumentCompletions(prefix) {
			const options = [
				{ value: "finalize", label: "finalize", description: "Consolidate decisions and save a self-contained map" },
				{ value: "save", label: "save", description: "Save the latest completed response verbatim" },
				{ value: "open", label: "open", description: "Select a saved map for this repository" },
				{ value: "implement", label: "implement", description: "Hand off the selected map to a fresh session" },
				{ value: "help", label: "help", description: "Show sketch command usage" },
			];
			const matches = options.filter((option) => option.value.startsWith(prefix));
			return matches.length ? matches : null;
		},
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the agent to finish before using /sketch.", "warning");
				return;
			}
			const trimmed = args.trim();
			const command = trimmed.match(/^\S+/)?.[0] ?? "";
			const instructions = trimmed.slice(command.length).trim();
			try {
				if (command === "help") {
					ctx.ui.notify(HELP, "info");
					return;
				}
				if (["save", "open", "implement"].includes(command) && instructions) throw new Error(HELP);
				if (command === "finalize") {
					if (!ctx.model) throw new Error("Select a model before finalizing a sketch.");
					const repo = await repository(ctx.cwd);
					const prompt = `${await promptFile("finalize.md", instructions)}\n\nFinalization request ID: ${randomUUID()}. Omit this ID from the map.`;
					pending = { prompt, started: false, sessionId: ctx.sessionManager.getSessionId(), repository: repo };
					pi.sendUserMessage(prompt);
					return;
				}
				if (command === "save") {
					const entry = latestAssistant(ctx.sessionManager.getBranch());
					if (!completedAssistant(entry)) throw new Error("No completed assistant response to save.");
					await save(entry, "snapshot", await repository(ctx.cwd), ctx);
					return;
				}
				if (command === "open" || command === "implement") {
					if (ctx.mode !== "tui") throw new Error(`${command} requires interactive mode.`);
					if (command === "implement" && ctx.ui.getEditorText().trim()) throw new Error("Submit or clear your editor draft before starting a fresh session.");
					const repo = await repository(ctx.cwd);
					let path = command === "implement" ? selectedMap(ctx) : undefined;
					if (path && (dirname(path) !== repo.directory || !await stat(path).then((s) => s.isFile()).catch(() => false))) path = undefined;
					if (!path) {
						const files = await readdir(repo.directory).catch((error: NodeJS.ErrnoException) => {
							if (error.code === "ENOENT") return [] as string[];
							throw error;
						});
						const maps = files.filter((file) => file.endsWith(".md")).sort().reverse();
						if (!maps.length) throw new Error("No saved sketches for this repository. Use /sketch finalize or /sketch save first.");
						const choice = await ctx.ui.select("Select a saved sketch", maps);
						if (!choice) return;
						path = join(repo.directory, choice);
						select(path, ctx);
					}
					if (command === "open") {
						ctx.ui.notify(`Selected sketch: ${path}\nUse /sketch implement to hand it off.`, "info");
						return;
					}
					const text = await readFile(path, "utf8");
					const approved = await ctx.ui.confirm("Start implementation in a fresh session?", `${path}\n\nConfirm that this is the map you want implemented. The existing session and saved map will be kept.`);
					if (!approved) return;
					const draft = `Implement the map saved at ${JSON.stringify(path)}.\n\nRead it first, then inspect the relevant repository files. Preserve its settled decisions. If the code contradicts an assumption or a decision needs changing, explain that before proceeding. Resolve blocking open questions with me. Run the validation described in the map. The saved commit is provenance, not an instruction to check out or reset the repository.\n\nThe exact handoff snapshot follows:\n\n${text}`;
					const result = await ctx.newSession({
						parentSession: ctx.sessionManager.getSessionFile(),
						setup: async (session) => { session.appendCustomEntry(SELECTION, { path }); },
						withSession: async (replacementCtx) => {
							updateStatus(replacementCtx, true);
							replacementCtx.ui.setEditorText(draft);
							replacementCtx.ui.notify("Sketch handoff ready. Review the draft and submit when ready.", "info");
						},
					});
					if (result.cancelled) ctx.ui.notify("Fresh session cancelled. Saved sketch retained.", "info");
					return;
				}
				pi.sendUserMessage(await promptFile("implementation-sketch.md", args));
			} catch (error) {
				pending = undefined;
				ctx.ui.notify(`Sketch: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
