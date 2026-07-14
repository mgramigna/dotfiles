import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { autocompleteSelect } from "./autocomplete-select";

const CONFIG_FILE_NAME = "trio.json";
const TRIO_STATE_ENTRY = "trio-workflow";
const MAX_REVIEW_ROUNDS = 5;

const TRANSITION_TOOLS = {
	delegate: "trio_delegate_to_executor",
	submit: "trio_submit_for_review",
	revise: "trio_request_changes",
	approve: "trio_approve",
} as const;

const TRANSITION_TOOL_NAMES = new Set<string>(Object.values(TRANSITION_TOOLS));
const READ_ONLY_TOOL_NAMES = ["read", "bash", "grep", "find", "ls", "ffgrep", "fffind"];
const EXECUTION_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls", "ffgrep", "fffind"];
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];
type TrioPhase = "idle" | "planning" | "executing" | "reviewing" | "finalizing";

interface TrioRoleConfig {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
}

interface TrioConfig {
	planner: TrioRoleConfig;
	executor: TrioRoleConfig;
	reviewer: TrioRoleConfig;
	maxReviewRounds?: number;
}

interface OriginalSessionState {
	model?: { provider: string; model: string };
	thinkingLevel: ThinkingLevel;
	tools: string[];
}

interface TrioWorkflowState {
	version: 1;
	active: boolean;
	phase: TrioPhase;
	task: string;
	reviewRound: number;
	original: OriginalSessionState;
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
	if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !THINKING_LEVELS.includes(thinkingLevel as ThinkingLevel))) {
		throw new Error(`${label}.thinkingLevel must be one of ${THINKING_LEVELS.join(", ")}`);
	}
	if (systemPrompt !== undefined && typeof systemPrompt !== "string") throw new Error(`${label}.systemPrompt must be a string`);

	return {
		provider: provider.trim(),
		model: model.trim(),
		...(thinkingLevel === undefined ? {} : { thinkingLevel: thinkingLevel as ThinkingLevel }),
		...(systemPrompt === undefined ? {} : { systemPrompt }),
	};
}

function mergeTrioConfig(base: TrioConfig | undefined, value: unknown, source: string): TrioConfig {
	if (!isRecord(value)) throw new Error(`${source} must contain a JSON object`);
	const maxReviewRounds = value.maxReviewRounds ?? base?.maxReviewRounds;
	if (maxReviewRounds !== undefined && (!Number.isInteger(maxReviewRounds) || (maxReviewRounds as number) < 0 || (maxReviewRounds as number) > 20)) {
		throw new Error(`${source}.maxReviewRounds must be an integer between 0 and 20`);
	}
	return {
		planner: readRoleConfig(value.planner, base?.planner, `${source}.planner`),
		executor: readRoleConfig(value.executor, base?.executor, `${source}.executor`),
		reviewer: readRoleConfig(value.reviewer, base?.reviewer, `${source}.reviewer`),
		...(maxReviewRounds === undefined ? {} : { maxReviewRounds: maxReviewRounds as number }),
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

function phaseLabel(phase: TrioPhase): string {
	return phase;
}

function uniqueAvailable(names: string[], availableTools: Set<string>): string[] {
	return [...new Set(names)].filter((name) => availableTools.has(name));
}

function getToolsForPhase(phase: TrioPhase, originalTools: string[], availableToolNames: string[]): string[] {
	const availableTools = new Set(availableToolNames);
	const originalWithoutTransitions = originalTools.filter((name) => !TRANSITION_TOOL_NAMES.has(name));
	if (phase === "idle") return uniqueAvailable(originalWithoutTransitions, availableTools);
	if (phase === "executing") return uniqueAvailable([...originalWithoutTransitions, ...EXECUTION_TOOL_NAMES, TRANSITION_TOOLS.submit], availableTools);
	const readOnlyBase = originalWithoutTransitions.filter((name) => name !== "edit" && name !== "write");
	if (phase === "planning") return uniqueAvailable([...readOnlyBase, ...READ_ONLY_TOOL_NAMES, TRANSITION_TOOLS.delegate], availableTools);
	if (phase === "reviewing") return uniqueAvailable([...readOnlyBase, ...READ_ONLY_TOOL_NAMES, TRANSITION_TOOLS.revise, TRANSITION_TOOLS.approve], availableTools);
	return uniqueAvailable([...readOnlyBase, ...READ_ONLY_TOOL_NAMES], availableTools);
}

function appendRoleSystemPrompt(instructions: string, systemPrompt = ""): string {
	return systemPrompt.trim() ? `${instructions}\n\n[TRIO ROLE SYSTEM PROMPT]\n${systemPrompt.trim()}` : instructions;
}

function getPhaseInstructions(state: TrioWorkflowState, config: TrioConfig): string | undefined {
	if (!state.active) return undefined;
	if (state.phase === "planning") {
		return appendRoleSystemPrompt(`[TRIO PHASE: PLANNING]\nYou are the planner and orchestrator. Understand the request, inspect the codebase as needed, and produce a concrete implementation plan for the executor.\nDo not edit files. When the plan is ready, call ${TRANSITION_TOOLS.delegate} with the task, ordered plan, acceptance criteria, and relevant files.\nThe transition tool must be the only tool call in that response. Do not give the user a final answer instead of delegating.\n\nOriginal task:\n${state.task}`, config.planner.systemPrompt);
	}
	if (state.phase === "executing") {
		return appendRoleSystemPrompt(`[TRIO PHASE: EXECUTION]\nYou are the executor. Implement the delegated plan in the current working tree, using the conversation and tool results as shared context.\nRun relevant tests or checks. When implementation is complete or blocked, call ${TRANSITION_TOOLS.submit} with a factual summary, tests run, and unresolved issues.\nThe transition tool must be the only tool call in that response. Do not provide the final user-facing answer.`, config.executor.systemPrompt);
	}
	if (state.phase === "reviewing") {
		const round = `${state.reviewRound}/${config.maxReviewRounds ?? MAX_REVIEW_ROUNDS}`;
		return appendRoleSystemPrompt(`[TRIO PHASE: REVIEW — round ${round}]\nYou are the reviewer. Independently review the executor's work and available validation evidence; do not rely only on the executor summary.\nDo not edit files yourself. If changes are needed, call ${TRANSITION_TOOLS.revise}. Otherwise call ${TRANSITION_TOOLS.approve} and clearly record any remaining concerns.\nThe transition tool must be the only tool call in that response.`, config.reviewer.systemPrompt);
	}
	if (state.phase === "finalizing") {
		return appendRoleSystemPrompt(`[TRIO PHASE: FINAL RESPONSE]\nThe implementation has been reviewed and approved. Give the user the final concise summary, including changes made, validation run, and any remaining caveats.\nDo not call additional Trio transition tools.`, config.planner.systemPrompt);
	}
	return undefined;
}

function parsePersistedState(value: unknown): TrioWorkflowState | undefined {
	if (!isRecord(value) || value.version !== 1 || typeof value.active !== "boolean" || typeof value.task !== "string") return undefined;
	if (!["idle", "planning", "executing", "reviewing", "finalizing"].includes(String(value.phase))) return undefined;
	if (!Number.isInteger(value.reviewRound) || (value.reviewRound as number) < 0) return undefined;
	if (!isRecord(value.original) || !Array.isArray(value.original.tools) || !value.original.tools.every((tool) => typeof tool === "string")) return undefined;
	const thinkingLevel = value.original.thinkingLevel;
	if (typeof thinkingLevel !== "string" || !THINKING_LEVELS.includes(thinkingLevel as ThinkingLevel)) return undefined;
	let model: { provider: string; model: string } | undefined;
	if (value.original.model !== undefined) {
		if (!isRecord(value.original.model) || typeof value.original.model.provider !== "string" || typeof value.original.model.model !== "string") return undefined;
		model = { provider: value.original.model.provider, model: value.original.model.model };
	}
	return { version: 1, active: value.active, phase: value.phase as TrioPhase, task: value.task, reviewRound: value.reviewRound as number, original: { model, thinkingLevel: thinkingLevel as ThinkingLevel, tools: [...value.original.tools] } };
}

function readLatestWorkflowState(entries: Array<{ type?: string; customType?: string; data?: unknown }>): TrioWorkflowState | undefined {
	let latest: TrioWorkflowState | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== TRIO_STATE_ENTRY) continue;
		const parsed = parsePersistedState(entry.data);
		if (parsed) latest = parsed;
	}
	return latest;
}

export default function trioExtension(pi: ExtensionAPI): void {
	let config: TrioConfig | undefined;
	let configPaths: string[] = [];
	let state: TrioWorkflowState | undefined;
	let toolsRegistered = false;
	let announcedPhaseKey: string | undefined;

	function requireConfig(): TrioConfig {
		if (!config) throw new Error("Trio is not configured. Run /trio setup.");
		return config;
	}

	async function runOnboarding(ctx: ExtensionContext): Promise<TrioConfig | undefined> {
		const configPath = join(getAgentDir(), CONFIG_FILE_NAME);
		const models = ctx.modelRegistry.getAvailable();
		if (models.length === 0) {
			ctx.ui.notify("No authenticated models are available. Configure a model with /login first.", "error");
			return undefined;
		}
		async function choose(title: string): Promise<Model<any> | undefined> {
			const selected = await autocompleteSelect(ctx, {
				title,
				items: models.map((m: Model<any>) => ({ label: modelKey(m), value: modelKey(m), description: m.name })),
			});
			if (!selected) return undefined;
			const [provider, ...modelParts] = selected.split("/");
			return ctx.modelRegistry.find(provider!, modelParts.join("/"));
		}
		const planner = await choose("Trio setup: choose the planner model");
		if (!planner) return undefined;
		const executor = await choose("Trio setup: choose the executor model");
		if (!executor) return undefined;
		const reviewerChoice = await autocompleteSelect(ctx, { title: "Trio setup: choose the reviewer", items: [{ label: `Use planner as reviewer (${modelKey(planner)})`, value: "planner" }, { label: "Select a custom reviewer model", value: "custom" }] });
		if (!reviewerChoice) return undefined;
		const reviewer = reviewerChoice === "custom" ? await choose("Trio setup: choose the reviewer model") : planner;
		if (!reviewer) return undefined;
		const selectedConfig: TrioConfig = { planner: { provider: planner.provider, model: planner.id }, executor: { provider: executor.provider, model: executor.id }, reviewer: { provider: reviewer.provider, model: reviewer.id }, maxReviewRounds: MAX_REVIEW_ROUNDS };
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

	function persistState(): void {
		if (state) pi.appendEntry(TRIO_STATE_ENTRY, state);
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!state?.active) {
			ctx.ui.setStatus("trio", undefined);
			return;
		}
		const maxRounds = config?.maxReviewRounds ?? MAX_REVIEW_ROUNDS;
		const round = state.phase === "reviewing" ? ` (${state.reviewRound + 1}/${maxRounds})` : "";
		ctx.ui.setStatus("trio", ctx.ui.theme.fg("dim", `trio: ${phaseLabel(state.phase)}${round}`));
	}

	function requirePhase(expected: TrioPhase): TrioWorkflowState {
		if (!state?.active || state.phase !== expected) throw new Error(`Trio tool is only valid during the ${expected} phase`);
		return state;
	}

	function resolveRole(ctx: ExtensionContext, role: TrioRoleConfig): Model<any> {
		const model = ctx.modelRegistry.find(role.provider, role.model);
		if (!model) throw new Error(`Configured Trio model not found: ${role.provider}/${role.model}`);
		return model;
	}

	async function selectRole(ctx: ExtensionContext, role: TrioRoleConfig): Promise<void> {
		const model = resolveRole(ctx, role);
		const usage = ctx.getContextUsage();
		if (usage?.tokens != null && usage.tokens >= model.contextWindow * 0.95) throw new Error(`Cannot switch to ${role.provider}/${role.model}: current context uses ${usage.tokens} tokens, near its ${model.contextWindow}-token limit`);
		if (ctx.model?.provider !== model.provider || ctx.model.id !== model.id) {
			const selected = await pi.setModel(model);
			if (!selected) throw new Error(`No credentials available for ${role.provider}/${role.model}`);
		}
		if (role.thinkingLevel !== undefined) pi.setThinkingLevel(role.thinkingLevel);
	}

	function activateToolsForPhase(phase: TrioPhase): void {
		if (!state) return;
		pi.setActiveTools(getToolsForPhase(phase, state.original.tools, pi.getAllTools().map((tool) => tool.name)));
	}

	async function enterPhase(phase: Exclude<TrioPhase, "idle">, ctx: ExtensionContext): Promise<void> {
		if (!state) throw new Error("Trio workflow state is unavailable");
		const currentConfig = requireConfig();
		const role = phase === "executing" ? currentConfig.executor : phase === "reviewing" ? currentConfig.reviewer : currentConfig.planner;
		await selectRole(ctx, role);
		state = { ...state, active: true, phase };
		activateToolsForPhase(phase);
		persistState();
		updateStatus(ctx);
	}

	async function restoreOriginalState(ctx: ExtensionContext, message?: string): Promise<void> {
		if (!state) return;
		announcedPhaseKey = undefined;
		const original = state.original;
		state = { ...state, active: false, phase: "idle" };
		pi.setActiveTools(getToolsForPhase("idle", original.tools, pi.getAllTools().map((tool) => tool.name)));
		if (original.model) {
			const model = ctx.modelRegistry.find(original.model.provider, original.model.model);
			if (model) await pi.setModel(model);
		}
		pi.setThinkingLevel(original.thinkingLevel);
		persistState();
		updateStatus(ctx);
		if (message) ctx.ui.notify(message, "info");
	}

	function ensureToolsRegistered(): void {
		if (toolsRegistered) return;
		toolsRegistered = true;

		pi.registerTool({ name: TRANSITION_TOOLS.delegate, label: "Delegate to Trio Executor", description: "Hand the implementation plan to the configured Trio executor model. Call this as the only tool in the response.", parameters: Type.Object({ task: Type.String(), plan: Type.Array(Type.String(), { minItems: 1 }), acceptanceCriteria: Type.Array(Type.String(), { minItems: 1 }), relevantFiles: Type.Optional(Type.Array(Type.String())) }), async execute(_id, params, _signal, _onUpdate, ctx) { requirePhase("planning"); await enterPhase("executing", ctx); return { content: [{ type: "text", text: `Execution delegated. Implement the following plan, validate it, then call ${TRANSITION_TOOLS.submit}.\n\nTask: ${params.task}\n\nPlan:\n${params.plan.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\nAcceptance criteria:\n${params.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}${params.relevantFiles?.length ? `\n\nRelevant files:\n${params.relevantFiles.map((file) => `- ${file}`).join("\n")}` : ""}` }], details: { phase: "executing", plan: params.plan } }; } });

		pi.registerTool({ name: TRANSITION_TOOLS.submit, label: "Submit Trio Work for Review", description: "Return completed executor work to the configured Trio reviewer model. Call this as the only tool in the response.", parameters: Type.Object({ summary: Type.String(), testsRun: Type.Array(Type.String()), unresolvedIssues: Type.Optional(Type.Array(Type.String())) }), async execute(_id, params, _signal, _onUpdate, ctx) { requirePhase("executing"); await enterPhase("reviewing", ctx); return { content: [{ type: "text", text: `Executor submitted work for review.\n\nSummary:\n${params.summary}\n\nValidation:\n${params.testsRun.length ? params.testsRun.map((test) => `- ${test}`).join("\n") : "- None reported"}${params.unresolvedIssues?.length ? `\n\nUnresolved issues:\n${params.unresolvedIssues.map((issue) => `- ${issue}`).join("\n")}` : ""}` }], details: { phase: "reviewing", reviewRound: state?.reviewRound ?? 0 } }; } });

		pi.registerTool({ name: TRANSITION_TOOLS.revise, label: "Request Trio Changes", description: "Send concrete review findings back to the Trio executor. Call this as the only tool in the response.", parameters: Type.Object({ issues: Type.Array(Type.String(), { minItems: 1 }), requiredChanges: Type.Array(Type.String(), { minItems: 1 }) }), async execute(_id, params, _signal, _onUpdate, ctx) { const current = requirePhase("reviewing"); const max = requireConfig().maxReviewRounds ?? MAX_REVIEW_ROUNDS; if (current.reviewRound >= max) throw new Error(`Maximum review rounds (${max}) reached. Call ${TRANSITION_TOOLS.approve} and report remaining concerns.`); state = { ...current, reviewRound: current.reviewRound + 1 }; await enterPhase("executing", ctx); return { content: [{ type: "text", text: `Review requested another implementation pass. Address every required change, re-run validation, then call ${TRANSITION_TOOLS.submit}.\n\nIssues:\n${params.issues.map((issue) => `- ${issue}`).join("\n")}\n\nRequired changes:\n${params.requiredChanges.map((change) => `- ${change}`).join("\n")}` }], details: { phase: "executing", reviewRound: state?.reviewRound ?? 0 } }; } });

		pi.registerTool({ name: TRANSITION_TOOLS.approve, label: "Approve Trio Work", description: "Approve the implementation and move to final response. Call this as the only tool in the response.", parameters: Type.Object({ summary: Type.String(), remainingConcerns: Type.Optional(Type.Array(Type.String())) }), async execute(_id, params, _signal, _onUpdate, ctx) { requirePhase("reviewing"); await enterPhase("finalizing", ctx); return { content: [{ type: "text", text: `Review approved. Now provide the final response to the user.\n\nReview conclusion:\n${params.summary}${params.remainingConcerns?.length ? `\n\nRemaining concerns:\n${params.remainingConcerns.map((concern) => `- ${concern}`).join("\n")}` : ""}` }], details: { phase: "finalizing", reviewRound: state?.reviewRound ?? 0 } }; } });
	}

	function doctorCheck(name: string, check: () => void): string {
		try {
			check();
			return `✓ ${name}`;
		} catch (error) {
			return `✗ ${name}: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	function runDoctor(ctx: ExtensionCommandContext): string {
		const globalPath = join(getAgentDir(), CONFIG_FILE_NAME);
		const projectPath = join(ctx.cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
		let loadedConfig: TrioConfig | undefined;
		let loadedPaths: string[] = [];
		const checks = [
			doctorCheck("config", () => {
				const loaded = loadConfig(ctx);
				loadedConfig = loaded.config;
				loadedPaths = loaded.paths;
				if (!loadedConfig) throw new Error(`not configured; run /trio setup to create ${globalPath}`);
			}),
			doctorCheck(`global config ${globalPath}`, () => {
				if (!existsSync(globalPath)) throw new Error("not found");
			}),
			ctx.isProjectTrusted()
				? existsSync(projectPath)
					? `✓ project config ${projectPath}`
					: `- project config ${projectPath}: not found; optional`
				: `- project config ${projectPath}: skipped; project is not trusted`,
			doctorCheck("configured models", () => {
				if (!loadedConfig) throw new Error("config unavailable");
				resolveRole(ctx, loadedConfig.planner);
				resolveRole(ctx, loadedConfig.executor);
				resolveRole(ctx, loadedConfig.reviewer);
			}),
			doctorCheck("transition tools", () => {
				ensureToolsRegistered();
				const tools = new Set(pi.getAllTools().map((tool) => tool.name));
				for (const tool of TRANSITION_TOOL_NAMES) {
					if (!tools.has(tool)) throw new Error(`${tool} is not registered`);
				}
			}),
			doctorCheck("session state", () => {
				if (!state) return;
				if (state.active && state.phase === "idle") throw new Error("active workflow has idle phase");
				if (state.reviewRound < 0) throw new Error("review round is negative");
			}),
		];
		return [
			"trio doctor",
			`status: ${state?.active ? `${state.phase} (${state.reviewRound}/${loadedConfig?.maxReviewRounds ?? MAX_REVIEW_ROUNDS})` : "idle"}`,
			`config paths: ${loadedPaths.length ? loadedPaths.join(", ") : "none"}`,
			...checks,
		].join("\n");
	}

	async function startWorkflow(task: string, ctx: ExtensionCommandContext): Promise<void> {
		if (state?.active) {
			ctx.ui.notify(`Trio is already active in the ${state.phase} phase. Use /trio stop first.`, "warning");
			return;
		}
		const currentConfig = await ensureConfigured(ctx);
		if (!currentConfig) return;
		announcedPhaseKey = undefined;
		resolveRole(ctx, currentConfig.planner);
		resolveRole(ctx, currentConfig.executor);
		resolveRole(ctx, currentConfig.reviewer);
		const original: OriginalSessionState = { model: ctx.model ? { provider: ctx.model.provider, model: ctx.model.id } : undefined, thinkingLevel: pi.getThinkingLevel(), tools: pi.getActiveTools() };
		ensureToolsRegistered();
		state = { version: 1, active: true, phase: "planning", task, reviewRound: 0, original };
		try {
			await enterPhase("planning", ctx);
		} catch (error) {
			state = undefined;
			pi.setActiveTools(original.tools);
			throw error;
		}
		pi.sendUserMessage(`[TRIO WORKFLOW REQUEST]\n${task}`);
		await ctx.waitForIdle();
	}

	pi.registerCommand("trio", {
		description: "Run an interactive planner → executor → reviewer workflow",
		getArgumentCompletions(prefix) {
			const items = ["status", "config", "doctor", "setup", "stop", "start "].map((value) => ({ value, label: value }));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input) {
				ctx.ui.notify("Usage: /trio <task> | /trio status | /trio config | /trio doctor | /trio setup | /trio stop", "info");
				return;
			}
			try {
				if (input === "status") {
					ctx.ui.notify(state?.active ? `Trio phase: ${state.phase}; review rounds used: ${state.reviewRound}/${requireConfig().maxReviewRounds ?? MAX_REVIEW_ROUNDS}` : "Trio is idle. Transition tools are not active.", "info");
					return;
				}
				if (input === "config") {
					const loaded = loadConfig(ctx);
					config = loaded.config;
					configPaths = loaded.paths;
					ctx.ui.notify(config ? `Trio config (${configPaths.join(", ")}):\n${JSON.stringify(config, null, 2)}` : `Trio is not configured. Run /trio setup. Config will be saved to ${join(getAgentDir(), CONFIG_FILE_NAME)}.`, "info");
					return;
				}
				if (input === "doctor") {
					ctx.ui.notify(runDoctor(ctx), "info");
					return;
				}
				if (input === "setup") {
					if (state?.active) ctx.ui.notify("Stop the active Trio workflow before changing its models.", "warning");
					else await runOnboarding(ctx);
					return;
				}
				if (input === "stop") {
					if (!state?.active) ctx.ui.notify("Trio is already idle.", "info");
					else {
						if (!ctx.isIdle()) {
							ctx.abort();
							await ctx.waitForIdle();
						}
						await restoreOriginalState(ctx, "Trio stopped; previous model and tools restored.");
					}
					return;
				}
				const task = input.startsWith("start ") ? input.slice("start ".length).trim() : input;
				if (!task) throw new Error("Usage: /trio start <task>");
				await ctx.waitForIdle();
				await startWorkflow(task, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("tool_call", (event, ctx) => {
		if (!TRANSITION_TOOL_NAMES.has(event.toolName)) return;
		const branch = ctx.sessionManager.getBranch();
		for (let index = branch.length - 1; index >= 0; index--) {
			const entry = branch[index];
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const calls = entry.message.content.filter((content) => content.type === "toolCall");
			if (calls.some((call) => call.id === event.toolCallId) && calls.length > 1) {
				return { block: true, reason: `${event.toolName} must be the only tool call in its response. Finish the other calls, then retry the transition alone.` };
			}
		}
	});

	(pi as any).on("context", (event: any) => {
		if (!state?.active || !config) return;
		const phaseKey = `${state.phase}:${state.reviewRound}`;
		if (phaseKey === announcedPhaseKey) return;
		const instructions = getPhaseInstructions(state, config);
		if (!instructions) return;
		announcedPhaseKey = phaseKey;
		const phaseMessage: any = { role: "custom", customType: "trio-phase", content: instructions, display: false, timestamp: Date.now() };
		return { messages: [...event.messages, phaseMessage] };
	});

	pi.on("session_compact", () => {
		announcedPhaseKey = undefined;
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (state?.active && state.phase === "finalizing") await restoreOriginalState(ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			const loaded = loadConfig(ctx);
			config = loaded.config;
			configPaths = loaded.paths;
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			config = undefined;
			configPaths = [];
		}
		state = readLatestWorkflowState(ctx.sessionManager.getBranch() as SessionEntry[]);
		if (state?.active) {
			try {
				ensureToolsRegistered();
				await enterPhase(state.phase === "idle" ? "planning" : state.phase, ctx);
			} catch (error) {
				ctx.ui.notify(`Could not restore Trio workflow: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		}
		updateStatus(ctx);
	});
}
