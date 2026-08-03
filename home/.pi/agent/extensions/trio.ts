import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { autocompleteSelect } from "../shared/autocomplete-select";

const CONFIG_FILE_NAME = "trio.json";
const EXECUTOR_TOOL = "trio_delegate_to_executor";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const CONFIG_THINKING_LEVELS = [...THINKING_LEVELS, "max"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];
type ConfigThinkingLevel = (typeof CONFIG_THINKING_LEVELS)[number];

interface TrioRoleConfig {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
}

interface TrioConfig {
	planner: TrioRoleConfig;
	executor: TrioRoleConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRoleConfig(value: unknown, fallback: TrioRoleConfig | undefined, label: string): TrioRoleConfig {
	if (value !== undefined && !isRecord(value)) throw new Error(`${label} must be an object`);
	const role = (value ?? {}) as Record<string, unknown>;
	const provider = role.provider ?? fallback?.provider;
	const model = role.model ?? fallback?.model;
	const thinkingLevel = role.thinkingLevel ?? fallback?.thinkingLevel;
	const systemPrompt = role.systemPrompt ?? fallback?.systemPrompt;

	if (typeof provider !== "string" || !provider.trim()) throw new Error(`${label}.provider must be a non-empty string`);
	if (typeof model !== "string" || !model.trim()) throw new Error(`${label}.model must be a non-empty string`);
	if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !CONFIG_THINKING_LEVELS.includes(thinkingLevel as ConfigThinkingLevel))) {
		throw new Error(`${label}.thinkingLevel must be one of ${CONFIG_THINKING_LEVELS.join(", ")}`);
	}
	if (systemPrompt !== undefined && typeof systemPrompt !== "string") throw new Error(`${label}.systemPrompt must be a string`);

	return {
		provider: provider.trim(),
		model: model.trim(),
		...(thinkingLevel === undefined ? {} : { thinkingLevel: (thinkingLevel === "max" ? "xhigh" : thinkingLevel) as ThinkingLevel }),
		...(systemPrompt === undefined ? {} : { systemPrompt }),
	};
}

function mergeTrioConfig(base: TrioConfig | undefined, value: unknown, source: string): TrioConfig {
	if (!isRecord(value)) throw new Error(`${source} must contain a JSON object`);
	return {
		planner: readRoleConfig(value.planner, base?.planner, `${source}.planner`),
		executor: readRoleConfig(value.executor, base?.executor, `${source}.executor`),
	};
}

function readJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function loadConfig(ctx: ExtensionContext): { config: TrioConfig | undefined; paths: string[] } {
	let config: TrioConfig | undefined;
	const paths: string[] = [];
	const globalPath = join(getAgentDir(), CONFIG_FILE_NAME);
	const projectPath = join(ctx.cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
	if (existsSync(globalPath)) {
		config = mergeTrioConfig(undefined, readJsonFile(globalPath), globalPath);
		paths.push(globalPath);
	}
	if (ctx.isProjectTrusted() && existsSync(projectPath)) {
		config = mergeTrioConfig(config, readJsonFile(projectPath), projectPath);
		paths.push(projectPath);
	}
	return { config, paths };
}

function modelKey(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

function plannerInstructions(task: string, config: TrioConfig): string {
	const base = `You are the Trio planner. Plan the user's work, then delegate implementation to the executor by calling ${EXECUTOR_TOOL}.

When the executor finishes, inspect its transcript and the working tree. If the result is acceptable, create a git commit yourself using a Conventional Commits message. If it is not acceptable, delegate a focused follow-up to the executor. Do not claim completion until the commit has been created.

Original task:\n${task}`;
	return config.planner.systemPrompt?.trim() ? `${base}\n\n[TRIO PLANNER SYSTEM PROMPT]\n${config.planner.systemPrompt.trim()}` : base;
}

function executorPrompt(task: string, plan: string, config: TrioConfig): string {
	const extra = config.executor.systemPrompt?.trim() ? `\n\n[TRIO EXECUTOR SYSTEM PROMPT]\n${config.executor.systemPrompt.trim()}` : "";
	return `/impl-review\n\nYou are the Trio executor. Implement the planner's delegated task in this working tree. Run relevant validation. Because this prompt is /impl-review, perform the implementation-review workflow, including the overseer review tool, before you finish. Do not commit; the planner will inspect and commit after you return.\n\nTask:\n${task}\n\nPlanner instructions:\n${plan}${extra}`;
}

function runHerdr(args: string[], input?: string): string {
	return execFileSync("herdr", args, { encoding: "utf8", input });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
		const timeout = setTimeout(cleanupAndResolve, ms);
		function cleanupAndResolve(): void {
			if (signal) signal.removeEventListener("abort", cleanupAndReject);
			resolve();
		}
		function cleanupAndReject(): void {
			clearTimeout(timeout);
			reject(signal?.reason ?? new Error("Aborted"));
		}
		signal?.addEventListener("abort", cleanupAndReject, { once: true });
	});
}

function parsePaneId(json: string): string {
	const parsed = JSON.parse(json) as { result?: { pane?: { pane_id?: string } } };
	const paneId = parsed.result?.pane?.pane_id;
	if (!paneId) throw new Error("Could not read new Herdr pane id");
	return paneId;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function getPaneAgentStatus(paneId: string): string | undefined {
	const parsed = JSON.parse(runHerdr(["pane", "list"])) as { result?: { panes?: Array<{ pane_id?: string; agent_status?: string }> } };
	const pane = parsed.result?.panes?.find((candidate) => candidate.pane_id === paneId);
	if (!pane) throw new Error(`Trio executor pane disappeared: ${paneId}`);
	return pane.agent_status;
}

async function waitForExecutor(paneId: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
	const startedAt = Date.now();
	let lastStatus: string | undefined;
	while (Date.now() - startedAt < timeoutMs) {
		lastStatus = getPaneAgentStatus(paneId);
		if (lastStatus === "done" || lastStatus === "idle" || lastStatus === "blocked") return lastStatus;
		await sleep(10_000, signal);
	}
	throw new Error(`Timed out waiting for Trio executor pane ${paneId} after ${Math.round(timeoutMs / 1000)}s (last status: ${lastStatus ?? "unknown"})`);
}

async function runExecutorInHerdr(task: string, plan: string, config: TrioConfig, ctx: ExtensionContext, signal?: AbortSignal): Promise<string> {
	if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) throw new Error("Trio executor requires running inside herdr (HERDR_ENV=1)");
	const paneId = parsePaneId(runHerdr(["pane", "split", process.env.HERDR_PANE_ID, "--direction", "right", "--no-focus"]));
	const modelArg = `${config.executor.provider}/${config.executor.model}${config.executor.thinkingLevel ? `:${config.executor.thinkingLevel}` : ""}`;
	const command = [
		"pi",
		"--provider", config.executor.provider,
		"--model", modelArg,
		"--name", "trio executor",
		executorPrompt(task, plan, config),
	].map(shellQuote).join(" ");
	runHerdr(["pane", "run", paneId, command]);
	const status = await waitForExecutor(paneId, 1_200_000, signal);
	const transcript = runHerdr(["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "240"]);
	ctx.ui.notify(`Trio executor reached ${status} in pane ${paneId}.`, status === "blocked" ? "warning" : "info");
	return transcript;
}

export default function trioExtension(pi: ExtensionAPI): void {
	pi.registerMessageRenderer("trio-kickoff", (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : String(message.content ?? "");
		const header = `${theme.fg("accent", "◆")} ${theme.fg("accent", theme.bold("Trio planner started"))}`;
		const text = content.trim() ? `${header}\n${theme.fg("muted", content.trim())}` : header;
		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	let config: TrioConfig | undefined;
	let configPaths: string[] = [];
	let task: string | undefined;
	let toolsRegistered = false;
	let originalTools: string[] | undefined;

	function requireConfig(): TrioConfig {
		if (!config) throw new Error("Trio is not configured. Run /trio setup.");
		return config;
	}

	function resolveRole(ctx: ExtensionContext, role: TrioRoleConfig): Model<any> {
		const model = ctx.modelRegistry.find(role.provider, role.model);
		if (!model) throw new Error(`Configured Trio model not found: ${role.provider}/${role.model}`);
		return model;
	}

	async function selectRole(ctx: ExtensionContext, role: TrioRoleConfig): Promise<void> {
		const model = resolveRole(ctx, role);
		if (ctx.model?.provider !== model.provider || ctx.model.id !== model.id) {
			const selected = await pi.setModel(model);
			if (!selected) throw new Error(`No credentials available for ${role.provider}/${role.model}`);
		}
		if (role.thinkingLevel !== undefined) pi.setThinkingLevel(role.thinkingLevel);
	}

	async function runOnboarding(ctx: ExtensionContext): Promise<TrioConfig | undefined> {
		const configPath = join(getAgentDir(), CONFIG_FILE_NAME);
		const models = ctx.modelRegistry.getAvailable();
		if (models.length === 0) {
			ctx.ui.notify("No authenticated models are available. Configure a model with /login first.", "error");
			return undefined;
		}
		async function chooseModel(title: string): Promise<Model<any> | undefined> {
			const selected = await autocompleteSelect(ctx, { title, items: models.map((m: Model<any>) => ({ label: modelKey(m), value: modelKey(m), description: m.name })) });
			if (!selected) return undefined;
			const [provider, ...modelParts] = selected.split("/");
			return ctx.modelRegistry.find(provider!, modelParts.join("/"));
		}
		async function chooseThinkingLevel(title: string): Promise<ThinkingLevel | undefined | "cancelled"> {
			const selected = await autocompleteSelect(ctx, {
				title,
				items: [
					{ label: "Use pi default", value: "default", description: "Do not set a Trio-specific reasoning level" },
					...CONFIG_THINKING_LEVELS.map((level) => ({ label: level, value: level, description: level === "max" ? "Alias for xhigh" : undefined })),
				],
			});
			if (!selected) return "cancelled";
			if (selected === "default") return undefined;
			return (selected === "max" ? "xhigh" : selected) as ThinkingLevel;
		}
		const planner = await chooseModel("Trio setup: choose the planner model");
		if (!planner) return undefined;
		const plannerThinkingLevel = await chooseThinkingLevel("Trio setup: choose the planner reasoning level");
		if (plannerThinkingLevel === "cancelled") return undefined;
		const executor = await chooseModel("Trio setup: choose the executor model");
		if (!executor) return undefined;
		const executorThinkingLevel = await chooseThinkingLevel("Trio setup: choose the executor reasoning level");
		if (executorThinkingLevel === "cancelled") return undefined;
		const selectedConfig: TrioConfig = {
			planner: { provider: planner.provider, model: planner.id, ...(plannerThinkingLevel === undefined ? {} : { thinkingLevel: plannerThinkingLevel }) },
			executor: { provider: executor.provider, model: executor.id, ...(executorThinkingLevel === undefined ? {} : { thinkingLevel: executorThinkingLevel }) },
		};
		mkdirSync(getAgentDir(), { recursive: true });
		writeFileSync(configPath, `${JSON.stringify(selectedConfig, null, "\t")}\n`, "utf8");
		config = selectedConfig;
		configPaths = [configPath];
		ctx.ui.notify(`Trio setup complete. Saved to ${configPath}.`, "info");
		return selectedConfig;
	}

	async function ensureConfigured(ctx: ExtensionContext): Promise<TrioConfig | undefined> {
		const loaded = loadConfig(ctx);
		config = loaded.config;
		configPaths = loaded.paths;
		return config ?? runOnboarding(ctx);
	}

	function ensureToolRegistered(): void {
		if (toolsRegistered) return;
		toolsRegistered = true;
		pi.registerTool({
			name: EXECUTOR_TOOL,
			label: "Delegate to Trio Executor",
			description: "Run the configured Trio executor in a Herdr agent pane with the /impl-review prompt.",
			parameters: Type.Object({ plan: Type.String() }),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const currentTask = task;
				if (!currentTask) throw new Error("No active Trio task");
				const transcript = await runExecutorInHerdr(currentTask, params.plan, requireConfig(), ctx, signal);
				return { content: [{ type: "text", text: `Executor finished. Review the transcript and working tree, request another executor pass if needed, otherwise commit the result.\n\nExecutor transcript:\n${transcript}` }], details: { pane: "herdr" } };
			},
		});
	}

	async function startWorkflow(request: string, ctx: ExtensionCommandContext): Promise<void> {
		const currentConfig = await ensureConfigured(ctx);
		if (!currentConfig) return;
		resolveRole(ctx, currentConfig.planner);
		resolveRole(ctx, currentConfig.executor);
		ensureToolRegistered();
		task = request;
		originalTools = pi.getActiveTools();
		await selectRole(ctx, currentConfig.planner);
		pi.setActiveTools([...new Set([...originalTools, EXECUTOR_TOOL])]);
		ctx.ui.setStatus("trio", `${ctx.ui.theme.fg("accent", "◆")} ${ctx.ui.theme.fg("dim", "trio:")} planner`);
		await pi.sendMessage({ customType: "trio-kickoff", content: request, display: true }, { triggerTurn: true, deliverAs: "followUp" });
		await pi.sendMessage({ customType: "trio-instructions", content: plannerInstructions(request, currentConfig), display: false }, { triggerTurn: true, deliverAs: "followUp" });
	}

	function stop(ctx: ExtensionCommandContext): void {
		task = undefined;
		ctx.ui.setStatus("trio", undefined);
		if (originalTools) pi.setActiveTools(originalTools);
		originalTools = undefined;
	}

	pi.registerCommand("trio", {
		description: "Run a simple planner → Herdr executor → planner commit workflow",
		getArgumentCompletions(prefix) {
			const items = ["status", "config", "setup", "stop", "start "].map((value) => ({ value, label: value }));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input) {
				ctx.ui.notify("Usage: /trio <task> | /trio status | /trio config | /trio setup | /trio stop", "info");
				return;
			}
			try {
				if (input === "status") return ctx.ui.notify(task ? `Trio planner active: ${task}` : "Trio is idle.", "info");
				if (input === "config") {
					const loaded = loadConfig(ctx);
					config = loaded.config;
					configPaths = loaded.paths;
					return ctx.ui.notify(config ? `Trio config (${configPaths.join(", ")}):\n${JSON.stringify(config, null, 2)}` : `Trio is not configured. Run /trio setup.`, "info");
				}
				if (input === "setup") return void (await runOnboarding(ctx));
				if (input === "stop") return stop(ctx);
				const request = input.startsWith("start ") ? input.slice("start ".length).trim() : input;
				if (!request) throw new Error("Usage: /trio start <task>");
				await ctx.waitForIdle();
				await startWorkflow(request, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			const loaded = loadConfig(ctx);
			config = loaded.config;
			configPaths = loaded.paths;
			ensureToolRegistered();
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	});
}
