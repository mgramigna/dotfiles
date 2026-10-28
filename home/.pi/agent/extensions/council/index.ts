import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPath, loadConfig } from "./config.ts";
import { runCouncil } from "./council.ts";
import { createProgress, type CouncilProgress } from "./progress.ts";
import { renderProgress, resultComponent, type CouncilResultDetails } from "./ui.ts";
import { latestCouncilRun, resolveRunDirectory, summaryRequest } from "./summary.ts";

interface BackgroundReview {
	controller: AbortController;
	done: Promise<void>;
	progress: CouncilProgress;
	visible: boolean;
	refresh?: () => void;
	timer?: ReturnType<typeof setInterval>;
}

// Deliberately command-only. Never register a model-callable council tool or auto-review event.
export default function council(pi: ExtensionAPI) {
	let active: BackgroundReview | undefined;
	let last: CouncilProgress | undefined;
	let alive = true;
	let generation = 0;
	const current = (task: BackgroundReview) => alive && active === task;
	const stopTimer = (task: BackgroundReview | undefined) => { if (task?.timer) clearInterval(task.timer); };
	const clearWidget = (ctx: ExtensionContext) => { if (ctx.mode === "tui") ctx.ui.setWidget("council", undefined); };
	const showWidget = (ctx: ExtensionContext, task?: BackgroundReview) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget("council", (tui, theme) => {
			const refresh = () => tui.requestRender();
			if (task) task.refresh = refresh;
			return {
				render: (width: number) => {
					const progress = task?.progress ?? last;
					return progress ? renderProgress(progress, theme, width) : [];
				},
				invalidate() {},
				dispose() { if (task?.refresh === refresh) task.refresh = undefined; },
			};
		});
	};

	pi.registerMessageRenderer<CouncilResultDetails>("council-result", (message, options, theme) => {
		const report = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
		return resultComponent(report, message.details, options.expanded, theme);
	});

	pi.on("session_shutdown", async () => {
		alive = false;
		generation++;
		const task = active;
		active = undefined;
		stopTimer(task);
		task?.controller.abort(new Error("Council cancelled because the parent session ended"));
		await task?.done;
	});
	// Tree navigation changes the destination branch without necessarily replacing the extension runtime.
	pi.on("session_tree", async (_event, ctx) => {
		generation++;
		const task = active;
		active = undefined;
		last = undefined;
		stopTimer(task);
		clearWidget(ctx);
		task?.controller.abort(new Error("Council cancelled because the session branch changed"));
		await task?.done;
	});

	pi.registerCommand("council", {
		description: "Background council review: <request> | summary [run-directory] | status | hide | config | cancel",
		getArgumentCompletions(prefix) {
			return [
				{ value: "review ", label: "review", description: "Describe any review target in plain language" },
				{ value: "review current uncommitted changes", label: "uncommitted changes" },
				{ value: "review commit ", label: "commit" },
				{ value: "review local branch ", label: "local branch" },
				{ value: "review PR ", label: "pull request" },
				{ value: "summary", label: "summary", description: "Ask the current agent to summarize the last council discussion" },
				{ value: "summary ", label: "summary <run-directory>", description: "Summarize a specific saved review directory or review ID" },
				{ value: "status", label: "status", description: "Show the live council panel or the last review's status" },
				{ value: "hide", label: "hide", description: "Hide the panel without stopping the review" },
				{ value: "config", label: "config", description: "Show configured council members and settings" },
				{ value: "cancel", label: "cancel", description: "Cancel the running council review" },
			].filter((item) => item.value.startsWith(prefix));
		},
		async handler(args, ctx) {
			if (!alive) return;
			const invocationGeneration = generation;
			const input = args.trim();
			if (/^summary(?:\s|$)/.test(input)) {
				try {
					const explicit = input.slice("summary".length).trim();
					if (!explicit && active) { ctx.ui.notify("The council is still running. Request /council summary after it finishes, or specify an earlier run directory.", "info"); return; }
					const runDir = explicit ? resolveRunDirectory(explicit, ctx.cwd) : last?.runDir ?? latestCouncilRun(ctx);
					if (!runDir) { ctx.ui.notify("No council report found in this session. Use /council summary <run-directory> for a saved review.", "info"); return; }
					const prompt = await summaryRequest(runDir);
					if (!alive || invocationGeneration !== generation) return;
					// This user explicitly requested a main-agent response. Queue it rather than steer an ongoing reply.
					pi.sendUserMessage(prompt, { deliverAs: "followUp" });
				} catch (error) { if (alive && invocationGeneration === generation) ctx.ui.notify(`Council summary unavailable: ${String(error)}`, "error"); }
				return;
			}
			if (input === "cancel") {
				if (active) {
					active.progress.phase = "cancelling";
					active.controller.abort(new Error("Council cancelled by user"));
					active.refresh?.();
				} else ctx.ui.notify("No council review is running.", "info");
				return;
			}
			if (input === "hide") {
				if (active) active.visible = false;
				clearWidget(ctx);
				return;
			}
			if (input === "status") {
				if (!active && !last) { ctx.ui.notify("No council review has run in this session.", "info"); return; }
				if (active) active.visible = true;
				showWidget(ctx, active);
				if (ctx.mode !== "tui") ctx.ui.notify(JSON.stringify(active?.progress ?? last, null, 2), "info");
				return;
			}
			try {
				const config = await loadConfig();
				if (!alive || invocationGeneration !== generation) return;
				if (input === "config") {
					ctx.ui.notify(`${configPath()}\n\n${JSON.stringify(config, null, 2)}`, "info");
					return;
				}
				if (active) { ctx.ui.notify("A council review is already running. Use /council cancel first.", "warning"); return; }
				const scope = input.replace(/^review(?:\s+|$)/, "").trim() || "Review the current uncommitted changes, including staged, unstaged and untracked files.";
				const task: BackgroundReview = { controller: new AbortController(), done: Promise.resolve(), progress: createProgress(scope, config), visible: true };
				active = task;
				last = undefined;
				showWidget(ctx, task);
				if (ctx.mode === "tui") task.timer = setInterval(() => { if (current(task) && task.visible) task.refresh?.(); }, 1000);
				else ctx.ui.notify("Council review started. /council status shows progress; /council cancel stops it.", "info");
				// Own the detached promise and all its errors. Do not await it on the interactive command path.
				task.done = (async () => {
					try {
						const result = await runCouncil({
							cwd: ctx.cwd, scope, config, controller: task.controller, trusted: ctx.isProjectTrusted(),
							onProgress() {},
							onUpdate(progress) {
								if (!current(task)) return;
								if (task.controller.signal.aborted && progress.phase !== "complete" && progress.phase !== "incomplete") progress.phase = "cancelling";
								task.progress = progress;
								if (task.visible) task.refresh?.();
							},
						});
						if (!current(task)) return;
						last = task.progress;
						// triggerTurn:false neither steers the ongoing chat nor requests an unsolicited agent turn.
						pi.sendMessage({ customType: "council-result", content: result.report, display: true, details: { runDir: result.runDir, incomplete: result.incomplete, progress: task.progress } }, { triggerTurn: false });
					} catch (error) {
						if (current(task)) {
							task.progress.phase = "incomplete";
							task.progress.finishedAt = Date.now();
							last = task.progress;
							ctx.ui.notify(`Council failed: ${String(error)}`, "error");
						}
					} finally {
						stopTimer(task);
						if (current(task)) { active = undefined; clearWidget(ctx); }
					}
				})();
				// Batch modes have no chat loop to release, and must keep the process alive for the report.
				if (ctx.mode !== "tui" && ctx.mode !== "rpc") await task.done;
			} catch (error) { if (alive) ctx.ui.notify(`Council failed: ${String(error)}`, "error"); }
		},
	});
}
