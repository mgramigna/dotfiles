import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { autocompleteSelect } from "./autocomplete-select";

type Worktree = {
	path: string;
	branch?: string;
	detached?: string;
	bare?: boolean;
};

function expandPath(input: string, cwd: string): string {
	const trimmed = input.trim();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
	return resolve(cwd, trimmed);
}

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function insideGitWorktree(cwd: string): boolean {
	try {
		return git(["rev-parse", "--is-inside-work-tree"], cwd) === "true";
	} catch {
		return false;
	}
}

function listWorktrees(cwd: string): Worktree[] {
	const output = git(["worktree", "list", "--porcelain"], cwd);
	const worktrees: Worktree[] = [];
	let current: Worktree | undefined;

	for (const line of output.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current) worktrees.push(current);
			current = { path: line.slice("worktree ".length) };
		} else if (!current) {
			continue;
		} else if (line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
		} else if (line.startsWith("detached ")) {
			current.detached = line.slice("detached ".length);
		} else if (line === "bare") {
			current.bare = true;
		}
	}
	if (current) worktrees.push(current);

	return worktrees.filter((w) => !w.bare);
}

function describeWorktree(w: Worktree, cwd: string): string {
	const marker = resolve(w.path) === resolve(cwd) ? "● " : "  ";
	const suffix = w.branch ? ` (${w.branch})` : w.detached ? ` (detached ${w.detached.slice(0, 12)})` : "";
	return `${marker}${w.path}${suffix}`;
}

function parseChoicePath(choice: string): string {
	return choice.replace(/^[● ]\s*/, "").replace(/ \((?:[^()]*)\)$/, "");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("move", {
		description: "Move the current pi session to another git worktree",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const currentSessionFile = ctx.sessionManager.getSessionFile();
			if (!currentSessionFile) {
				ctx.ui.notify("Cannot move an ephemeral --no-session session.", "error");
				return;
			}

			let targetCwd: string | undefined;
			if (args.trim()) {
				targetCwd = expandPath(args, ctx.cwd);
			} else {
				if (!insideGitWorktree(ctx.cwd)) {
					ctx.ui.notify("/move must be run from inside a git worktree, or pass a target path.", "error");
					return;
				}

				const worktrees = listWorktrees(ctx.cwd);
				if (worktrees.length === 0) {
					ctx.ui.notify("No git worktrees found.", "warning");
					return;
				}

				const choices = worktrees.map((w) => describeWorktree(w, ctx.cwd));
				const choice = await autocompleteSelect(ctx, {
					title: "Move session to git worktree",
					items: choices.map((choice) => ({ value: choice, label: choice })),
					maxVisible: 12,
					noMatchText: "  No matching worktrees",
				});
				if (!choice) return;
				targetCwd = parseChoicePath(choice);
			}

			if (!existsSync(targetCwd) || !statSync(targetCwd).isDirectory()) {
				ctx.ui.notify(`Target is not a directory: ${targetCwd}`, "error");
				return;
			}
			if (!insideGitWorktree(targetCwd)) {
				ctx.ui.notify(`Target is not a git worktree: ${targetCwd}`, "error");
				return;
			}
			if (resolve(targetCwd) === resolve(ctx.cwd)) {
				ctx.ui.notify("Already in that worktree.", "info");
				return;
			}

			const moved = SessionManager.forkFrom(currentSessionFile, targetCwd, undefined, {
				parentSession: currentSessionFile,
			});
			const movedSessionFile = moved.getSessionFile();
			if (!movedSessionFile) {
				ctx.ui.notify("Failed to create moved session file.", "error");
				return;
			}

			await ctx.switchSession(movedSessionFile, {
				withSession: async (ctx) => {
					ctx.ui.notify(`Moved session to ${targetCwd}`, "info");
				},
			});
		},
	});
}
