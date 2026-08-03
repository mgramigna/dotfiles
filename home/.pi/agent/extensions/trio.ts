import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	isToolCallEventType,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { autocompleteSelect } from "../shared/autocomplete-select";

const CONFIG_FILE = "trio.json";
const SPAWN_TOOL = "trio_spawn_executor";
const POLL_TOOL = "trio_poll_executor";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const CONFIG_THINKING_LEVELS = [...THINKING_LEVELS, "max"] as const;
const PLANNER_TOOLS = [
	"bash",
	"read",
	"fffind",
	"ffgrep",
	"linear_get_issue",
	"fetch_content",
	"get_search_content",
	SPAWN_TOOL,
	POLL_TOOL,
] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];
type ConfigThinkingLevel = (typeof CONFIG_THINKING_LEVELS)[number];

type RoleConfig = {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
};

type TrioConfig = {
	planner: RoleConfig;
	executor: RoleConfig;
};

type ExecutorRun = {
	paneId: string;
	startedAt: number;
};

const spawnSchema = Type.Object({
	instructions: Type.String({ description: "Focused implementation instructions for the executor." }),
});
type SpawnInput = Static<typeof spawnSchema>;

const pollSchema = Type.Object({
	paneId: Type.String({ description: "Herdr pane id returned by trio_spawn_executor." }),
	timeoutSeconds: Type.Optional(Type.Number({ description: "Maximum time to wait. Defaults to 1800 seconds." })),
});
type PollInput = Static<typeof pollSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function roleFrom(value: unknown, fallback: RoleConfig | undefined, label: string): RoleConfig {
	if (value !== undefined && !isRecord(value)) throw new Error(`${label} must be an object`);
	const raw = (value ?? {}) as Record<string, unknown>;
	const provider = raw.provider ?? fallback?.provider;
	const model = raw.model ?? fallback?.model;
	const thinking = raw.thinkingLevel ?? fallback?.thinkingLevel;
	if (typeof provider !== "string" || !provider.trim()) throw new Error(`${label}.provider is required`);
	if (typeof model !== "string" || !model.trim()) throw new Error(`${label}.model is required`);
	if (thinking !== undefined && (typeof thinking !== "string" || !CONFIG_THINKING_LEVELS.includes(thinking as ConfigThinkingLevel))) {
		throw new Error(`${label}.thinkingLevel must be one of ${CONFIG_THINKING_LEVELS.join(", ")}`);
	}
	return {
		provider: provider.trim(),
		model: model.trim(),
		...(thinking === undefined ? {} : { thinkingLevel: (thinking === "max" ? "xhigh" : thinking) as ThinkingLevel }),
	};
}

function mergeConfig(base: TrioConfig | undefined, raw: unknown, source: string): TrioConfig {
	if (!isRecord(raw)) throw new Error(`${source} must be a JSON object`);
	return {
		planner: roleFrom(raw.planner, base?.planner, `${source}.planner`),
		executor: roleFrom(raw.executor, base?.executor, `${source}.executor`),
	};
}

function loadConfig(ctx: ExtensionContext): { config: TrioConfig | undefined; paths: string[] } {
	let config: TrioConfig | undefined;
	const paths: string[] = [];
	const globalPath = join(getAgentDir(), CONFIG_FILE);
	const projectPath = join(ctx.cwd, CONFIG_DIR_NAME, CONFIG_FILE);
	if (existsSync(globalPath)) {
		config = mergeConfig(config, readJson(globalPath), globalPath);
		paths.push(globalPath);
	}
	if (ctx.isProjectTrusted() && existsSync(projectPath)) {
		config = mergeConfig(config, readJson(projectPath), projectPath);
		paths.push(projectPath);
	}
	return { config, paths };
}

function modelLabel(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function herdr(args: string[], input?: string): string {
	return execFileSync("herdr", args, { encoding: "utf8", input });
}

function paneIdFromSplit(output: string): string {
	const parsed = JSON.parse(output) as { result?: { pane?: { pane_id?: string } } };
	const paneId = parsed.result?.pane?.pane_id;
	if (!paneId) throw new Error("Herdr did not return a pane id");
	return paneId;
}

function paneStatus(paneId: string): string {
	const parsed = JSON.parse(herdr(["pane", "list"])) as { result?: { panes?: Array<{ pane_id?: string; agent_status?: string }> } };
	const pane = parsed.result?.panes?.find((candidate) => candidate.pane_id === paneId);
	if (!pane) throw new Error(`Herdr pane not found: ${paneId}`);
	return pane.agent_status ?? "unknown";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout);
			reject(signal.reason ?? new Error("Aborted"));
		}, { once: true });
	});
}

async function waitForStarted(paneId: string, signal?: AbortSignal): Promise<string> {
	const deadline = Date.now() + 60_000;
	let status = paneStatus(paneId);
	while (Date.now() < deadline) {
		if (!["idle", "unknown"].includes(status)) return status;
		await sleep(1_000, signal);
		status = paneStatus(paneId);
	}
	throw new Error(`Timed out waiting for executor ${paneId} to start; last status was ${status}`);
}

async function waitForDone(paneId: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let status = paneStatus(paneId);
	while (Date.now() < deadline) {
		if (["done", "idle", "blocked"].includes(status)) return status;
		await sleep(10_000, signal);
		status = paneStatus(paneId);
	}
	throw new Error(`Timed out waiting for ${paneId}; last status was ${status}`);
}

function executorPrompt(task: string, instructions: string): string {
	return `/impl-review

You are the Trio executor. Implement the delegated task in this working tree.

Hard requirements:
- Do not commit.
- Run relevant tests/typechecks.
- Run overseer review.
- Address overseer findings and rerun review until it passes or only explicitly non-blocking comments remain.
- Finish with a concise summary, validations run, and final overseer outcome.

Original user task:
${task}

Planner delegation:
${instructions}`;
}

function plannerPrompt(task: string): string {
	return `You are the Trio planner.

Workflow:
1. Investigate and plan using read-only/search tools and bash as needed.
2. You are forbidden from editing files. Do not call edit or write. Do not use shell redirection, heredocs, perl/python/ruby/node scripts, or other bash tricks to modify files.
3. Delegate implementation with ${SPAWN_TOOL}.
4. Poll the executor with ${POLL_TOOL} until it is done.
5. Inspect the executor transcript and working tree. If more work is needed, delegate a focused follow-up and poll again.
6. When acceptable, run light verification only; do not edit.
7. Create the git commit yourself with a Conventional Commits message.

Original user task:
${task}`;
}

function bashLooksMutating(command: string): boolean {
	return /(^|[;&|]\s*)(cat\s*>|tee\b|printf\b.*>|echo\b.*>|python\b|python3\b|perl\b|ruby\b|node\b|ed\b|ex\b|vim\b|nvim\b|rm\b|mv\b|cp\b|touch\b|truncate\b)/m.test(command) || /<<\s*['"]?\w+/.test(command);
}

export default function trio(pi: ExtensionAPI): void {
	let config: TrioConfig | undefined;
	let originalTools: string[] | undefined;
	let task: string | undefined;
	let plannerActive = false;
	const runs = new Map<string, ExecutorRun>();

	function requireConfig(): TrioConfig {
		if (!config) throw new Error("Trio is not configured. Run /trio setup.");
		return config;
	}

	function resolveModel(ctx: ExtensionContext, role: RoleConfig): Model<any> {
		const model = ctx.modelRegistry.find(role.provider, role.model);
		if (!model) throw new Error(`Configured model not available: ${role.provider}/${role.model}`);
		return model;
	}

	async function selectModel(ctx: ExtensionContext, role: RoleConfig): Promise<void> {
		const model = resolveModel(ctx, role);
		if (ctx.model?.provider !== model.provider || ctx.model.id !== model.id) {
			const ok = await pi.setModel(model);
			if (!ok) throw new Error(`No credentials available for ${role.provider}/${role.model}`);
		}
		if (role.thinkingLevel) pi.setThinkingLevel(role.thinkingLevel);
	}

	async function setup(ctx: ExtensionCommandContext): Promise<void> {
		const models = ctx.modelRegistry.getAvailable();
		if (models.length === 0) throw new Error("No authenticated models are available. Run /login first.");
		const globalPath = join(getAgentDir(), CONFIG_FILE);
		const projectPath = join(ctx.cwd, CONFIG_DIR_NAME, CONFIG_FILE);
		const configTarget = ctx.isProjectTrusted()
			? await autocompleteSelect(ctx, {
				title: "Where should Trio save this config?",
				items: [
					{ label: "Project-local", value: "project", description: projectPath },
					{ label: "Global", value: "global", description: globalPath },
				],
			})
			: "global";
		if (!configTarget) throw new Error("Setup cancelled");
		if (configTarget === "global" && !ctx.isProjectTrusted()) ctx.ui.notify("Project is not trusted; saving Trio config globally.", "info");
		async function chooseModel(title: string): Promise<Model<any>> {
			const selected = await autocompleteSelect(ctx, { title, items: models.map((m: Model<any>) => ({ label: modelLabel(m), value: modelLabel(m), description: m.name })) });
			if (!selected) throw new Error("Setup cancelled");
			const [provider, ...modelParts] = selected.split("/");
			const model = ctx.modelRegistry.find(provider!, modelParts.join("/"));
			if (!model) throw new Error(`Model not found: ${selected}`);
			return model;
		}
		async function chooseThinking(title: string): Promise<ThinkingLevel | undefined> {
			const selected = await autocompleteSelect(ctx, {
				title,
				items: [{ label: "Use pi default", value: "default" }, ...CONFIG_THINKING_LEVELS.map((level) => ({ label: level, value: level }))],
			});
			if (!selected) throw new Error("Setup cancelled");
			if (selected === "default") return undefined;
			return (selected === "max" ? "xhigh" : selected) as ThinkingLevel;
		}
		const planner = await chooseModel("Trio planner model");
		const plannerThinking = await chooseThinking("Trio planner thinking");
		const executor = await chooseModel("Trio executor model");
		const executorThinking = await chooseThinking("Trio executor thinking");
		config = {
			planner: { provider: planner.provider, model: planner.id, ...(plannerThinking ? { thinkingLevel: plannerThinking } : {}) },
			executor: { provider: executor.provider, model: executor.id, ...(executorThinking ? { thinkingLevel: executorThinking } : {}) },
		};
		const path = configTarget === "project" ? projectPath : globalPath;
		mkdirSync(configTarget === "project" ? join(ctx.cwd, CONFIG_DIR_NAME) : getAgentDir(), { recursive: true });
		writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
		ctx.ui.notify(`Trio config saved to ${path}${configTarget === "project" ? " (takes precedence over global config)" : ""}`, "info");
	}

	pi.registerTool({
		name: SPAWN_TOOL,
		label: "Trio: Spawn Executor",
		description: "Spawn a configured Trio executor in a Herdr pane. Returns once the agent has started working.",
		parameters: spawnSchema,
		async execute(_id, params: SpawnInput, signal, _onUpdate, ctx) {
			if (!task) throw new Error("No active Trio task");
			if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) throw new Error("Trio requires running inside herdr");
			const cfg = requireConfig();
			const paneId = paneIdFromSplit(herdr(["pane", "split", process.env.HERDR_PANE_ID, "--direction", "right", "--no-focus"]));
			const modelArg = `${cfg.executor.provider}/${cfg.executor.model}${cfg.executor.thinkingLevel ? `:${cfg.executor.thinkingLevel}` : ""}`;
			const command = ["pi", "--provider", cfg.executor.provider, "--model", modelArg, "--name", "trio executor", executorPrompt(task, params.instructions)].map(quote).join(" ");
			herdr(["pane", "run", paneId, command]);
			const status = await waitForStarted(paneId, signal);
			runs.set(paneId, { paneId, startedAt: Date.now() });
			ctx.ui.notify(`Trio executor started in ${paneId}`, "info");
			return { content: [{ type: "text", text: `Executor started in Herdr pane ${paneId} with status ${status}. Poll this pane with ${POLL_TOOL}.` }], details: { paneId, status } };
		},
	});

	pi.registerTool({
		name: POLL_TOOL,
		label: "Trio: Poll Executor",
		description: "Wait for a Trio executor pane to finish, then return its recent transcript.",
		parameters: pollSchema,
		async execute(_id, params: PollInput, signal, _onUpdate, ctx) {
			if (!runs.has(params.paneId)) throw new Error(`Unknown Trio executor pane: ${params.paneId}`);
			const status = await waitForDone(params.paneId, (params.timeoutSeconds ?? 1800) * 1000, signal);
			const transcript = herdr(["pane", "read", params.paneId, "--source", "recent-unwrapped", "--lines", "300"]);
			ctx.ui.notify(`Trio executor ${params.paneId} is ${status}`, status === "blocked" ? "warning" : "info");
			return { content: [{ type: "text", text: `Executor ${params.paneId} finished with status ${status}. Review transcript and working tree.\n\nTranscript:\n${transcript}` }], details: { paneId: params.paneId, status } };
		},
	});

	pi.on("tool_call", (event) => {
		if (!plannerActive) return;
		if (event.toolName === "edit" || event.toolName === "write") return { block: true, reason: "Trio planner is not allowed to edit files. Delegate implementation to the executor." };
		if (isToolCallEventType("bash", event) && bashLooksMutating(event.input.command)) {
			return { block: true, reason: "Trio planner bash is limited to non-mutating commands, except git commit. Use the executor for file changes." };
		}
	});

	async function start(request: string, ctx: ExtensionCommandContext): Promise<void> {
		const loaded = loadConfig(ctx);
		config = loaded.config;
		if (!config) return setup(ctx);
		resolveModel(ctx, config.planner);
		resolveModel(ctx, config.executor);
		task = request;
		plannerActive = true;
		originalTools = pi.getActiveTools();
		await selectModel(ctx, config.planner);
		pi.setActiveTools([...PLANNER_TOOLS]);
		ctx.ui.setStatus("trio", `${ctx.ui.theme.fg("accent", "◆")} ${ctx.ui.theme.fg("dim", "trio")}`);
		await pi.sendMessage({ customType: "trio-kickoff", content: `Trio started: ${request}`, display: true }, { triggerTurn: false, deliverAs: "followUp" });
		await pi.sendMessage({ customType: "trio-instructions", content: plannerPrompt(request), display: false }, { triggerTurn: true, deliverAs: "followUp" });
	}

	pi.registerCommand("trio", {
		description: "Planner/executor workflow with a read-only planner and Herdr executor",
		getArgumentCompletions(prefix) {
			return ["setup", "config", "start "].map((value) => ({ value, label: value })).filter((item) => item.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			try {
				const input = args.trim();
				if (!input) return ctx.ui.notify("Usage: /trio <task> | setup | config", "info");
				if (input === "setup") return void (await setup(ctx));
				if (input === "config") {
					const loaded = loadConfig(ctx);
					config = loaded.config;
					return ctx.ui.notify(config ? `Trio config (${loaded.paths.join(", ")}):\n${JSON.stringify(config, null, 2)}` : "Trio is not configured.", "info");
				}
				const request = input.startsWith("start ") ? input.slice("start ".length).trim() : input;
				if (!request) throw new Error("Usage: /trio start <task>");
				await ctx.waitForIdle();
				await start(request, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			config = loadConfig(ctx).config;
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	});
}
