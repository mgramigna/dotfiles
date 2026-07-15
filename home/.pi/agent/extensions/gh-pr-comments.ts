import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

interface PrView {
	number: number;
	title: string;
	url: string;
}

interface ReviewThreadComment {
	author?: {
		login?: string;
	};
	body?: string;
	path?: string;
	line?: number;
	url?: string;
	createdAt?: string;
}

interface ReviewThreadNode {
	isResolved?: boolean;
	path?: string;
	line?: number;
	comments?: {
		nodes?: ReviewThreadComment[];
	};
}

interface GraphQlResponse<T> {
	data?: T;
}

interface ReviewThreadsData {
	repository?: {
		pullRequest?: {
			reviewThreads?: {
				nodes?: ReviewThreadNode[];
			};
		};
	};
}

interface PrComment {
	id: string;
	author: string;
	body: string;
	path?: string;
	line?: number;
	url?: string;
	createdAt?: string;
	resolved?: boolean;
}

async function exec(args: string[], cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(args[0]!, args.slice(1), {
			cwd,
			maxBuffer: 10 * 1024 * 1024,
			timeout: 30_000,
		});
		return stdout.trim();
	} catch {
		return null;
	}
}

async function getGitRoot(cwd: string): Promise<string | null> {
	return exec(["git", "rev-parse", "--show-toplevel"], cwd);
}

async function ghJson<T>(args: string[], cwd: string): Promise<T | null> {
	const stdout = await exec(["gh", ...args], cwd);
	if (!stdout) return null;

	try {
		return JSON.parse(stdout) as T;
	} catch {
		return null;
	}
}

function truncate(text: string, maxLength: number): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function renderCommentRow(
	comment: PrComment,
	checked: boolean,
	index: number,
	isCurrent: boolean,
	maxWidth: number,
	theme: any,
): string {
	const location = comment.path
		? ` ${comment.path}${comment.line ? `:${comment.line}` : ""}`
		: "";
	const resolvedTag = comment.resolved ? " resolved" : "";
	const rest = `${index + 1}. @${comment.author}${location}${resolvedTag} — ${truncate(comment.body, 90)}`;

	if (isCurrent) {
		const mark = checked ? "☑" : "☐";
		return theme.fg("accent", truncateToWidth(`${mark} ${rest}`, maxWidth, ""));
	}

	const mark = checked ? theme.fg("success", "☑") : theme.fg("dim", "☐");
	const restColored = comment.resolved ? theme.fg("muted", rest) : theme.fg("text", rest);
	return truncateToWidth(`${mark} ${restColored}`, maxWidth, "");
}

function commentPrompt(comment: PrComment, index: number): string {
	const location = comment.path
		? `\nFile: ${comment.path}${comment.line ? `:${comment.line}` : ""}`
		: "";
	const url = comment.url ? `\nURL: ${comment.url}` : "";
	const resolved = comment.resolved === undefined ? "" : `\nResolved: ${comment.resolved ? "yes" : "no"}`;
	return `Comment ${index + 1}\nAuthor: @${comment.author}${location}${url}${resolved}\n\n${comment.body}`;
}

async function getCurrentPr(cwd: string): Promise<PrView | null> {
	return ghJson<PrView>(["pr", "view", "--json", "number,title,url"], cwd);
}

async function getOwnerAndRepo(cwd: string): Promise<{ owner: string; repo: string } | null> {
	const repo = await exec(["gh", "repo", "view", "--json", "owner,name", "--jq", ".owner.login + \"/\" + .name"], cwd);
	if (!repo?.includes("/")) return null;
	const [owner, name] = repo.split("/", 2);
	return owner && name ? { owner, repo: name } : null;
}

async function getReviewThreadComments(cwd: string, prNumber: number): Promise<PrComment[]> {
	const repo = await getOwnerAndRepo(cwd);
	if (!repo) return [];

	const query = `
		query($owner: String!, $repo: String!, $number: Int!) {
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $number) {
					reviewThreads(first: 100) {
						nodes {
							isResolved
							path
							line
							comments(first: 20) {
								nodes {
									author { login }
									body
									path
									line
									url
									createdAt
								}
							}
						}
					}
				}
			}
		}
	`;

	const response = await ghJson<GraphQlResponse<ReviewThreadsData>>(
		[
			"api",
			"graphql",
			"-f",
			`query=${query}`,
			"-F",
			`owner=${repo.owner}`,
			"-F",
			`repo=${repo.repo}`,
			"-F",
			`number=${prNumber}`,
		],
		cwd,
	);

	const threads = response?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
	return threads.flatMap((thread, threadIndex) => {
		const comments = thread.comments?.nodes ?? [];
		return comments.map((comment, commentIndex) => ({
			id: `${threadIndex}:${commentIndex}:${comment.url ?? comment.createdAt ?? comment.body ?? ""}`,
			author: comment.author?.login ?? "unknown",
			body: comment.body ?? "",
			path: comment.path ?? thread.path,
			line: comment.line ?? thread.line,
			url: comment.url,
			createdAt: comment.createdAt,
			resolved: thread.isResolved,
		}));
	});
}

async function choosePrompt(ctx: ExtensionCommandContext): Promise<string | null> {
	const implementPrompt = "Resolve the requested feedback in the codebase, then summarize what changed.";
	const discussPrefix = "Do not implement anything. Do not modify files. Treat the selected PR comments as context for discussion only.";
	const discussPlaceholder = "Explain what these comments mean and suggest options for addressing them.";
	const implementChoice = "Implement fixes";
	const discussChoice = "Discuss only / no code changes";
	const select = (ctx.ui as any).select as ((title: string, choices: string[]) => Promise<string | undefined>) | undefined;
	const input = (ctx.ui as any).input as ((prompt: string, placeholder?: string) => Promise<string | undefined>) | undefined;

	const choice = select
		? await select("Choose prompt for selected PR comments", [implementChoice, discussChoice, "Cancel"])
		: implementChoice;

	if (!choice || choice === "Cancel") return null;
	if (choice === implementChoice) return implementPrompt;

	if (!input) {
		ctx.ui.notify("Discuss-only prompts require a UI input prompt in this Pi build", "error");
		return null;
	}

	const userPrompt = (await input("What would you like to ask about these PR comments?", discussPlaceholder))?.trim();
	return userPrompt ? `${discussPrefix}\n\n${userPrompt}` : null;
}

async function chooseComments(ctx: ExtensionCommandContext, comments: PrComment[]): Promise<PrComment[]> {
	const selected = new Set<string>();
	const resolvedCount = comments.filter((comment) => comment.resolved).length;
	const unresolvedCount = comments.length - resolvedCount;

	const result = await ctx.ui.custom<PrComment[] | null>((tui, theme, keybindings, done) => {
		const border = new DynamicBorder((s: string) => theme.fg("accent", s));
		let showResolved = false;
		let selectedIndex = 2;

		const visibleComments = () => (showResolved ? comments : comments.filter((comment) => !comment.resolved));
		const itemCount = () => visibleComments().length + 2;
		const clampSelectedIndex = () => {
			selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, itemCount() - 1)));
		};
		const toggleComment = (comment: PrComment) => {
			if (selected.has(comment.id)) selected.delete(comment.id);
			else selected.add(comment.id);
		};

		return {
			render: (width) => {
				clampSelectedIndex();
				const visible = visibleComments();
				const title = `Select PR comments to address (${unresolvedCount} unresolved, ${resolvedCount} resolved)`;
				const doneLabel = selected.size === 0 ? "Done (select none)" : `Done (${selected.size} selected)`;
				const toggleResolvedLabel = showResolved
					? `Hide resolved comments (${resolvedCount})`
					: `Show resolved comments (${resolvedCount})`;
				const rowCount = visible.length + 2;
				const maxVisible = 14;
				const startIndex = Math.max(
					0,
					Math.min(selectedIndex - Math.floor(maxVisible / 2), rowCount - maxVisible),
				);
				const endIndex = Math.min(startIndex + maxVisible, rowCount);

				const lines: string[] = [];
				lines.push(...border.render(width));
				lines.push(theme.fg("accent", theme.bold(title)));

				for (let index = startIndex; index < endIndex; index++) {
					const isCurrent = index === selectedIndex;
					const prefix = isCurrent ? theme.fg("accent", "→ ") : "  ";
					let colored: string;
					if (index === 0) {
						const body = truncateToWidth(doneLabel, width - 2, "");
						colored = isCurrent ? theme.fg("accent", theme.bold(body)) : theme.fg("success", body);
					} else if (index === 1) {
						const body = truncateToWidth(toggleResolvedLabel, width - 2, "");
						colored = isCurrent ? theme.fg("accent", body) : theme.fg("muted", body);
					} else {
						const comment = visible[index - 2]!;
						colored = renderCommentRow(comment, selected.has(comment.id), index - 2, isCurrent, width - 2, theme);
					}
					lines.push(`${prefix}${colored}`);
				}

				if (startIndex > 0 || endIndex < rowCount) {
					lines.push(theme.fg("dim", `  (${selectedIndex + 1}/${rowCount})`));
				}

				lines.push(theme.fg("dim", "↑↓ navigate • enter toggles/moves next • done to start • esc cancel"));
				lines.push(...border.render(width));
				return lines;
			},
			invalidate: () => border.invalidate(),
			handleInput: (data) => {
				if (keybindings.matches(data, "tui.select.up")) {
					selectedIndex = selectedIndex === 0 ? itemCount() - 1 : selectedIndex - 1;
				} else if (keybindings.matches(data, "tui.select.down")) {
					selectedIndex = selectedIndex === itemCount() - 1 ? 0 : selectedIndex + 1;
				} else if (keybindings.matches(data, "tui.select.confirm")) {
					if (selectedIndex === 0) {
						done(comments.filter((comment) => selected.has(comment.id)));
						return;
					}
					if (selectedIndex === 1) {
						showResolved = !showResolved;
						clampSelectedIndex();
					} else {
						const comment = visibleComments()[selectedIndex - 2];
						if (comment) toggleComment(comment);
						selectedIndex = selectedIndex === itemCount() - 1 ? 0 : selectedIndex + 1;
					}
				} else if (keybindings.matches(data, "tui.select.cancel")) {
					done(null);
				}
				tui.requestRender();
			},
		};
	});

	return result ?? [];
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("pr-comments", {
		description: "Select GitHub PR review comments and ask pi to address them",
		handler: async (_args, ctx) => {
			const gitRoot = await getGitRoot(ctx.cwd);
			if (!gitRoot) {
				ctx.ui.notify("Not inside a git repository", "error");
				return;
			}

			const pr = await getCurrentPr(gitRoot);
			if (!pr) {
				ctx.ui.notify("No GitHub PR found for the current branch", "error");
				return;
			}

			const comments = await getReviewThreadComments(gitRoot, pr.number);
			if (comments.length === 0) {
				ctx.ui.notify(`No review comments found on PR #${pr.number}`, "info");
				return;
			}

			const selected = await chooseComments(ctx, comments);
			if (selected.length === 0) {
				ctx.ui.notify("No PR comments selected", "info");
				return;
			}

			const selectedPrompt = await choosePrompt(ctx);
			if (!selectedPrompt) {
				ctx.ui.notify("No prompt selected", "info");
				return;
			}

			const prompt = [
				`Address this PR comment${selected.length === 1 ? "" : "s"} on ${pr.url}.`,
				selectedPrompt,
				...selected.map(commentPrompt),
			].join("\n\n---\n\n");

			pi.sendUserMessage(prompt);
		},
	});
}
