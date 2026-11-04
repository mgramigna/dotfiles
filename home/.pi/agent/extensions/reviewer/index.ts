import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { conversationExcerpt } from "./context.ts";
import { completeOptions, help, parseOptions, type ReviewMode } from "./options.ts";
import { runReview } from "./runner.ts";
import { createProgress, renderProgress, resultComponent, type ReviewProgress, type ReviewResult, type ReviewResultDetails } from "./ui.ts";

interface BackgroundReview {
	controllers: AbortController[];
	done: Promise<void>;
	progress: ReviewProgress[];
	timer?: ReturnType<typeof setInterval>;
}

// Deliberately command-only. No model-callable review tool, prompt template, or automatic review hook.
export default function reviewer(pi: ExtensionAPI) {
	let active: BackgroundReview | undefined;
	let last: ReviewResult[] = [];
	let pending: ReviewResult[] = [];
	let alive = true;
	let generation = 0;
	let visible = false;
	let refresh: (() => void) | undefined;
	let registry: ExtensionContext["modelRegistry"] | undefined;
	const current = (task: BackgroundReview, invocation: number) => alive && generation === invocation && active === task;
	const clearWidget = (ctx: ExtensionContext) => {
		refresh = undefined;
		if (ctx.mode === "tui") ctx.ui.setWidget("reviewer", undefined);
	};
	const showWidget = (ctx: ExtensionContext) => {
		visible = true;
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget("reviewer", (tui, theme) => {
			const render = () => tui.requestRender();
			refresh = render;
			return {
				render(width: number) {
					const progress = active?.progress ?? last.map((result) => result.details.progress);
					return progress.flatMap((item) => renderProgress(item, theme, width, Date.now(), pending.some((result) => result.details.progress.mode === item.mode)));
				},
				invalidate() {},
				dispose() { if (refresh === render) refresh = undefined; },
			};
		});
	};
	const flush = (ctx: ExtensionContext) => {
		if (!alive || !pending.length || !ctx.isIdle()) return;
		const results = pending;
		pending = [];
		// Sending while streaming would steer or queue an unsolicited turn. Append only when idle.
		// nextTurn is not used: it defers display and can leak a queued result across tree navigation.
		for (const result of results) pi.sendMessage({ customType: "reviewer-result", content: result.report, display: true, details: result.details }, { triggerTurn: false });
		if (!active) { visible = false; clearWidget(ctx); }
	};
	const reset = async (ctx?: ExtensionContext) => {
		generation++;
		const task = active;
		active = undefined;
		last = [];
		pending = [];
		visible = false;
		if (task?.timer) clearInterval(task.timer);
		if (ctx) clearWidget(ctx);
		for (const controller of task?.controllers ?? []) controller.abort(new Error("Review cancelled because the parent session or branch changed"));
		await task?.done;
	};

	pi.registerMessageRenderer<ReviewResultDetails>("reviewer-result", (message, options, theme) => {
		const report = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
		return resultComponent(report, message.details, options.expanded, theme);
	});
	pi.on("session_start", (_event, ctx) => { alive = true; registry = ctx.modelRegistry; });
	pi.on("model_select", (_event, ctx) => { registry = ctx.modelRegistry; });
	pi.on("agent_settled", (_event, ctx) => { flush(ctx); });
	pi.on("session_tree", async (_event, ctx) => { await reset(ctx); });
	pi.on("session_shutdown", async (_event, ctx) => { alive = false; await reset(ctx); registry = undefined; });

	const register = (command: string, modes: ReviewMode[]) => pi.registerCommand(command, {
		description: `Background ${modes.length > 1 ? "parallel verifier and adversarial reviewer" : modes[0] === "verify" ? "verifier" : "adversarial reviewer"}: [--model provider/id] [--thinking level] [--context] <request> | status | hide | cancel | help`,
		getArgumentCompletions(prefix) {
			return completeOptions(prefix, registry?.getAvailable().map((model) => `${model.provider}/${model.id}`).sort() ?? []);
		},
		async handler(args, ctx) {
			if (!alive) return;
			registry = ctx.modelRegistry;
			try {
				const options = parseOptions(args, modes[0]);
				if (options.control === "help") { ctx.ui.notify(help, "info"); return; }
				if (options.control === "hide") { visible = false; clearWidget(ctx); return; }
				if (options.control === "cancel") {
					if (!active) { ctx.ui.notify("No review is running.", "info"); return; }
					for (const progress of active.progress) {
						if (progress.phase !== "complete" && progress.phase !== "incomplete") progress.phase = "cancelling";
					}
					for (const controller of active.controllers) controller.abort(new Error("Review cancelled by user"));
					if (visible) refresh?.();
					return;
				}
				if (options.control === "status") {
					flush(ctx);
					if (!active && !last.length) { ctx.ui.notify("No review has run in this session branch.", "info"); return; }
					showWidget(ctx);
					if (ctx.mode !== "tui") ctx.ui.notify(JSON.stringify(active?.progress ?? last.map((result) => result.details), null, 2), "info");
					return;
				}
				flush(ctx);
				if (active || pending.length) { ctx.ui.notify(active ? "A review is already running. Use /review cancel first." : "The previous report will be posted when the current response finishes.", "warning"); return; }
				const model = options.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
				if (!model) throw new Error("No current model. Select one with /model or pass --model provider/model-id.");
				if (!ctx.modelRegistry.getAvailable().some((candidate) => `${candidate.provider}/${candidate.id}` === model)) throw new Error(`Review model unavailable or unauthenticated: ${model}. Check /model and /login. No fallback was used.`);
				// Snapshot invocation-time values and reserve ownership before any asynchronous work.
				const invocation = generation;
				const task: BackgroundReview = { controllers: modes.map(() => new AbortController()), done: Promise.resolve(), progress: modes.map((mode) => createProgress(options.scope, model, options.thinking, mode)) };
				const request = { cwd: ctx.cwd, trusted: ctx.isProjectTrusted(), options: { ...options, model }, context: options.context ? conversationExcerpt(ctx) : undefined };
				active = task;
				last = [];
				showWidget(ctx);
				if (ctx.mode === "tui") task.timer = setInterval(() => { if (current(task, invocation) && visible) refresh?.(); }, 1000);
				else ctx.ui.notify("Review started. /review status shows progress; /review cancel stops it.", "info");
				// Own the detached promise and its cleanup. Do not block the TUI or RPC command loop.
				task.done = (async () => {
					try {
						// Each review owns its timeout/controller. A failed child must not stop its sibling.
						await Promise.all(modes.map(async (mode, index) => {
							try {
								const controller = task.controllers[index];
								const result = await runReview({ ...request, options: { ...request.options, mode }, controller, onUpdate(progress) {
									if (!current(task, invocation)) return;
									if (controller.signal.aborted && progress.phase !== "complete" && progress.phase !== "incomplete") progress.phase = "cancelling";
									task.progress[index] = progress;
									if (visible) refresh?.();
								} });
								if (!current(task, invocation)) return;
								last.push(result);
								pending.push(result);
								flush(ctx);
							} catch (error) {
								if (!current(task, invocation)) return;
								task.progress[index].phase = "incomplete";
								task.progress[index].finishedAt = Date.now();
								ctx.ui.notify(`${mode} review failed: ${String(error)}`, "error");
							}
						}));
					} catch (error) {
						if (current(task, invocation)) ctx.ui.notify(`Review failed: ${String(error)}`, "error");
					} finally {
						if (task.timer) clearInterval(task.timer);
						if (current(task, invocation)) {
							active = undefined;
							flush(ctx);
							if (!pending.length) { visible = false; clearWidget(ctx); }
							else if (visible) refresh?.();
						}
					}
				})();
				// Batch modes have no interactive chat loop to release.
				if (ctx.mode !== "tui" && ctx.mode !== "rpc") await task.done;
			} catch (error) { if (alive) ctx.ui.notify(`Review failed: ${String(error)}`, "error"); }
		},
	});
	register("review", ["verify"]);
	register("review-adversarial", ["adversarial"]);
	register("review-kitchen-sink", ["verify", "adversarial"]);
}
