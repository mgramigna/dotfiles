import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { homedir } from "node:os";

import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const STATUS_KEY = "swear-jar";
const AGENT_DIR = join(homedir(), ".pi", "agent");
const STATE_PATH = join(AGENT_DIR, "swear-jar.json");
const SESSIONS_DIR = join(AGENT_DIR, "sessions");

const SWEAR_PATTERNS: RegExp[] = [
	/\b(?:fuck(?:er|ers|ing|ed|s)?|fucking)\b/gi,
	/\b(?:shit(?:ty|ting|ted|s)?|bullshit|batshit|horseshit)\b/gi,
	/\b(?:asshole|assholes|jackass|jackasses|dumbass|dumbasses|badass|badasses)\b/gi,
	/\b(?:bitch(?:es|ing|ed|y)?|bastard|bastards)\b/gi,
	/\b(?:damn(?:ed|ing|s)?|goddamn(?:ed|it)?)\b/gi,
	/\b(?:crap|crappy|hell|piss(?:ed|ing|es)?)\b/gi,
	/\b(?:dick(?:head|heads|s)?|prick|pricks|cock(?:s)?)\b/gi,
	/\b(?:cunt|cunts|twat|twats)\b/gi,
];

interface SwearJarState {
	total: number;
}

interface SwearOccurrence {
	sessionFile: string;
	sessionCwd?: string;
	entryId: string;
	timestamp?: string;
	count: number;
	preview: string;
}

const COMMAND_COMPLETIONS: AutocompleteItem[] = [
	{ value: "jump", label: "jump", description: "Pick a swear jar entry and jump to that session/message" },
	{ value: "backfill", label: "backfill", description: "Recount swear words across existing pi sessions" },
	{ value: "history", label: "history", description: "Alias for backfill" },
	{ value: "historical", label: "historical", description: "Alias for backfill" },
	{ value: "recount", label: "recount", description: "Alias for backfill" },
	{ value: "reset", label: "reset", description: "Reset the swear jar count to zero" },
];

function countSwears(text: string): number {
	let total = 0;
	for (const pattern of SWEAR_PATTERNS) {
		const matches = text.match(pattern);
		if (matches) total += matches.length;
	}
	return total;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((block) => {
			if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
				return typeof block.text === "string" ? block.text : "";
			}
			return "";
		})
		.join("\n");
}

async function listSessionFiles(dir = SESSIONS_DIR): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const files = await Promise.all(entries.map(async (entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return listSessionFiles(path);
		return extname(entry.name) === ".jsonl" ? [path] : [];
	}));

	return files.flat();
}

async function findHistoricalSwears(): Promise<SwearOccurrence[]> {
	const files = await listSessionFiles();
	const occurrences: SwearOccurrence[] = [];

	for (const file of files) {
		let raw: string;
		try {
			raw = await readFile(file, "utf8");
		} catch {
			continue;
		}

		let sessionCwd: string | undefined;
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;

			try {
				const entry = JSON.parse(line) as {
					type?: string;
					id?: string;
					cwd?: string;
					timestamp?: string;
					message?: { role?: string; content?: unknown; timestamp?: number };
				};

				if (entry.type === "session") {
					sessionCwd = entry.cwd;
					continue;
				}

				if (entry.type !== "message" || entry.message?.role !== "user" || !entry.id) continue;

				const text = extractText(entry.message.content);
				const count = countSwears(text);
				if (count > 0) {
					occurrences.push({
						sessionFile: file,
						sessionCwd,
						entryId: entry.id,
						timestamp: entry.timestamp ?? (entry.message.timestamp ? new Date(entry.message.timestamp).toISOString() : undefined),
						count,
						preview: text.replace(/\s+/g, " ").trim().slice(0, 100),
					});
				}
			} catch {
				// Ignore malformed or partially-written lines.
			}
		}
	}

	return occurrences.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
}

async function countHistoricalSwears(): Promise<number> {
	const occurrences = await findHistoricalSwears();
	return occurrences.reduce((total, occurrence) => total + occurrence.count, 0);
}

async function loadState(): Promise<SwearJarState> {
	try {
		const raw = await readFile(STATE_PATH, "utf8");
		const parsed = JSON.parse(raw) as Partial<SwearJarState>;
		return { total: Math.max(0, Number(parsed.total) || 0) };
	} catch {
		return { total: 0 };
	}
}

async function saveState(state: SwearJarState): Promise<void> {
	await mkdir(dirname(STATE_PATH), { recursive: true });
	await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function renderStatus(ctx: ExtensionContext, total: number): string {
	const label = total === 1 ? "swear" : "swears";
	return ctx.ui.theme.fg("dim", `🤬 ${total} ${label}`);
}

const STATUS_VISIBLE_MS = 10_000;

let statusTimer: ReturnType<typeof setTimeout> | undefined;

function clearStatus(ctx: ExtensionContext): void {
	if (statusTimer) {
		clearTimeout(statusTimer);
		statusTimer = undefined;
	}
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

function showStatusTemporarily(ctx: ExtensionContext, total: number): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, renderStatus(ctx, total));

	if (statusTimer) clearTimeout(statusTimer);
	statusTimer = setTimeout(() => {
		statusTimer = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}, STATUS_VISIBLE_MS);
}

function logBackgroundError(action: string, error: unknown): void {
	console.warn(`[swear-jar] ${action} failed:`, error);
}

async function pathExists(path: string | undefined): Promise<boolean> {
	if (!path) return false;
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function formatOccurrence(occurrence: SwearOccurrence): string {
	const when = occurrence.timestamp ? new Date(occurrence.timestamp).toLocaleString() : "unknown time";
	const cwd = occurrence.sessionCwd ?? basename(dirname(occurrence.sessionFile));
	const count = occurrence.count === 1 ? "1 swear" : `${occurrence.count} swears`;
	return `${when} • ${count} • ${cwd} • ${occurrence.preview}`;
}

async function switchToOccurrence(ctx: ExtensionCommandContext, occurrence: SwearOccurrence): Promise<void> {
	let sessionFile = occurrence.sessionFile;
	const cwdExists = await pathExists(occurrence.sessionCwd);

	if (!cwdExists) {
		const ok = await ctx.ui.confirm(
			"Session worktree missing",
			`The original directory no longer exists:\n${occurrence.sessionCwd ?? "(unknown)"}\n\nFork this session into the current directory instead?`,
		);
		if (!ok) return;

		const forked = SessionManager.forkFrom(occurrence.sessionFile, ctx.cwd);
		sessionFile = forked.getSessionFile() ?? occurrence.sessionFile;
	}

	await ctx.switchSession(sessionFile, {
		withSession: async (nextCtx) => {
			const result = await nextCtx.navigateTree(occurrence.entryId, {
				summarize: false,
				label: "swear-jar",
			});
			if (result.cancelled) return;
			nextCtx.ui.notify("Jumped to swear jar entry", "info");
		},
	});
}

export default function (pi: ExtensionAPI) {
	let state: SwearJarState = { total: 0 };

	pi.on("session_start", (_event, ctx) => {
		// Do not block pi startup on disk I/O. Keep the status hidden until a new swear
		// is detected so the counter is not constantly in view.
		clearStatus(ctx);
		void loadState()
			.then((loadedState) => {
				state = loadedState;
			})
			.catch((error: unknown) => logBackgroundError("load", error));
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" as const };

		const swears = countSwears(event.text);
		if (swears > 0) {
			state.total += swears;
			showStatusTemporarily(ctx, state.total);
			void saveState(state).catch((error: unknown) => logBackgroundError("save", error));
		}

		return { action: "continue" as const };
	});

	pi.registerCommand("swearjar", {
		description: "Show, reset, or backfill the pi swear jar count",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const normalizedPrefix = prefix.trimStart().toLowerCase();
			const filtered = COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (command === "reset") {
				state = { total: 0 };
				await saveState(state);
				clearStatus(ctx);
				ctx.ui.notify("Swear jar reset", "info");
				return;
			}

			if (["backfill", "recount", "history", "historical"].includes(command)) {
				state = { total: await countHistoricalSwears() };
				await saveState(state);
				showStatusTemporarily(ctx, state.total);
				ctx.ui.notify(`Swear jar backfilled: ${state.total} total`, "info");
				return;
			}

			if (["jump", "goto", "open"].includes(command)) {
				const occurrences = await findHistoricalSwears();
				if (occurrences.length === 0) {
					ctx.ui.notify("No swear jar entries found", "info");
					return;
				}

				const choices = occurrences.map(formatOccurrence);
				const choice = await ctx.ui.select("Jump to swear jar entry", choices);
				if (!choice) return;

				const occurrence = occurrences[choices.indexOf(choice)];
				if (occurrence) await switchToOccurrence(ctx, occurrence);
				return;
			}

			state = await loadState();
			showStatusTemporarily(ctx, state.total);
			ctx.ui.notify(`Swear jar: ${state.total} total`, "info");
		},
	});
}
