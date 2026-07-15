import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { getAgentDir, type AgentToolResult, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { autocompleteSelect } from "../shared/autocomplete-select";

const execFileAsync = promisify(execFile);

const RUN_DIR = join(getAgentDir(), "advisor");
const ADVISOR_TIMEOUT_MS = 30 * 60 * 1000;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type AdvisorThinkingLevel = (typeof THINKING_LEVELS)[number];

interface AdvisorConfig {
	model?: string;
	thinking?: AdvisorThinkingLevel;
	maxContextEntries?: number;
	systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are advisor, a senior read-only technical advisor called by another coding agent.

Your job is to give careful, critical, high-signal advice on difficult questions. Do not edit files. Do not claim to have inspected files unless the prompt includes their contents. Prefer correctness, security, architecture, maintainability, debugging strategy, and hidden assumptions over style commentary.

Be direct and actionable. If the evidence is incomplete, say what is uncertain and what the coding agent should check next.`;

const defaultAdvisorConfig: AdvisorConfig = {
	thinking: "high",
	maxContextEntries: 20,
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

function getGlobalConfigPath(): string {
	return join(getAgentDir(), "advisor.json");
}

function getProjectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "advisor.json");
}

function isProjectTrusted(ctx: ExtensionContext): boolean {
	return (ctx as any).isProjectTrusted?.() ?? true;
}

async function configExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function loadOptionalConfig(path: string): Promise<AdvisorConfig | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	return parseAdvisorConfig(JSON.parse(raw), path);
}

async function loadAdvisorConfig(ctx: ExtensionContext): Promise<AdvisorConfig> {
	const globalConfig = await loadOptionalConfig(getGlobalConfigPath());
	const projectConfig = isProjectTrusted(ctx) ? await loadOptionalConfig(getProjectConfigPath(ctx.cwd)) : undefined;
	return { ...defaultAdvisorConfig, ...globalConfig, ...projectConfig };
}

function parseAdvisorConfig(value: unknown, path: string): AdvisorConfig {
	if (!isRecord(value)) throw new Error(`${path} must contain a JSON object`);
	const model = parseOptionalString(value.model, "model", path);
	const thinking = parseOptionalThinking(value.thinking, path);
	const systemPrompt = parseOptionalString(value.systemPrompt, "systemPrompt", path);
	const maxContextEntries = parseOptionalNumber(value.maxContextEntries, "maxContextEntries", path);
	return {
		...(model !== undefined ? { model } : {}),
		...(thinking !== undefined ? { thinking } : {}),
		...(systemPrompt !== undefined ? { systemPrompt } : {}),
		...(maxContextEntries !== undefined ? { maxContextEntries } : {}),
	};
}

function parseOptionalString(value: unknown, key: string, path: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path}: ${key} must be a non-empty string`);
	return value;
}

function parseOptionalNumber(value: unknown, key: string, path: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${path}: ${key} must be a non-negative integer`);
	return value;
}

function parseOptionalThinking(value: unknown, path: string): AdvisorThinkingLevel | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !THINKING_LEVELS.includes(value as AdvisorThinkingLevel)) {
		throw new Error(`${path}: thinking must be one of: ${THINKING_LEVELS.join(", ")}`);
	}
	return value as AdvisorThinkingLevel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function execText(command: string, args: string[], cwd?: string, timeout = 30_000): Promise<string> {
	const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout });
	return stdout.trimEnd();
}

async function listAvailableModels(cwd: string): Promise<string[]> {
	const output = await execText("pi", ["--list-models"], cwd, 30_000);
	return output
		.split("\n")
		.slice(1)
		.map((line) => {
			const [provider, model] = line.trim().split(/\s+/);
			return provider && model ? `${provider}/${model}` : undefined;
		})
		.filter((model): model is string => Boolean(model));
}

function currentModelArg(ctx: ExtensionContext): string | undefined {
	const model = (ctx as any).model;
	if (!model?.id) return undefined;
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

async function readConfigObjectIfExists(path: string): Promise<Record<string, unknown> | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	const parsed = JSON.parse(raw);
	if (!isRecord(parsed)) throw new Error(`advisor config at ${path} must be an object`);
	parseAdvisorConfig(parsed, path);
	return parsed;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatRecentSession(ctx: ExtensionContext, maxEntries: number): string {
	if (maxEntries <= 0) return "";
	const entries = ctx.sessionManager.getEntries().slice(-maxEntries);
	return entries
		.map((entry: any, index) => {
			const role = entry.role ?? entry.message?.role ?? entry.type ?? entry.customType ?? `entry-${index + 1}`;
			const content = entry.content ?? entry.message?.content ?? entry.text ?? entry;
			return `## ${role}\n${stringifyContent(content)}`;
		})
		.join("\n\n");
}

function stringifyContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((part: any) => {
				if (typeof part === "string") return part;
				if (part?.type === "text" && typeof part.text === "string") return part.text;
				return JSON.stringify(part);
			})
			.join("\n");
	}
	return JSON.stringify(value, null, 2);
}

async function runAdvisor(
	ctx: ExtensionContext,
	question: string,
	extraContext: string | undefined,
	includeRecentSession: boolean,
	onChunk?: (chunk: string, output: string) => void,
): Promise<{ output: string; model?: string; promptPath: string }> {
	const config = await loadAdvisorConfig(ctx);
	if (!config.model) {
		throw new Error(`Advisor model is not configured. Create ${getGlobalConfigPath()} or ${getProjectConfigPath(ctx.cwd)} with { "model": "provider/model-id" }.`);
	}

	await mkdir(RUN_DIR, { recursive: true });
	const promptPath = join(RUN_DIR, `prompt-${timestamp()}.md`);
	const recent = includeRecentSession ? formatRecentSession(ctx, config.maxContextEntries ?? 20) : "";
	const prompt = `# Advisor request\n\nWorking directory: ${ctx.cwd}\n\n## Question\n\n${question}\n\n## Additional context supplied by coding agent\n\n${extraContext?.trim() || "(none)"}\n\n## Recent session context\n\n${recent || "(not included)"}\n\n## Response instructions\n\nGive concise, actionable advice. Call out assumptions, risks, and specific next checks.`;
	await writeFile(promptPath, prompt, "utf8");

	const args = ["-p", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--model", config.model];
	if (config.thinking) args.push("--thinking", config.thinking);
	args.push("--name", "advisor", "--system-prompt", config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, `@${promptPath}`);
	const output = await spawnPi(args, ctx.cwd, onChunk);
	return { output: output.trim(), model: config.model, promptPath };
}

async function spawnPi(args: string[], cwd: string, onChunk?: (chunk: string, output: string) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`Advisor timed out after ${Math.round(ADVISOR_TIMEOUT_MS / 1000)}s`));
		}, ADVISOR_TIMEOUT_MS);

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			onChunk?.(chunk, stdout);
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timeout);
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(`Advisor exited with ${signal ?? `code ${code}`}\n${stderr.trim()}`));
			}
		});
	});
}

function previewLines(text: string, maxLines = 20): string[] {
	const lines = text.trimEnd().split("\n");
	return lines.slice(Math.max(0, lines.length - maxLines));
}

function setAdvisorStatus(ctx: ExtensionContext, text: string | undefined): void {
	ctx.ui.setStatus("advisor", text ? ctx.ui.theme.fg("dim", text) : undefined);
}

export default function advisor(pi: ExtensionAPI) {
	pi.registerTool({
		name: "advisor_ask",
		label: "Ask Advisor",
		description: "Ask a stronger read-only advisor model for difficult design, debugging, architecture, or correctness questions.",
		promptSnippet: "Ask a stronger read-only advisor model for difficult questions or when a second opinion is valuable.",
		promptGuidelines: [
			"Use advisor_ask for high-stakes design decisions, subtle bugs, security concerns, complex debugging, architecture tradeoffs, or when uncertain.",
			"Do not use advisor_ask for routine coding tasks; it is intended for important or difficult questions.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The specific question for the advisor." }),
			context: Type.Optional(Type.String({ description: "Additional context, code excerpts, hypotheses, or constraints to give the advisor." })),
			includeRecentSession: Type.Optional(Type.Boolean({ description: "Whether to include recent session transcript context. Defaults to true." })),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx): Promise<AgentToolResult<unknown>> {
			onUpdate?.({ content: [{ type: "text", text: "Asking advisor..." }], details: {} });
			const result = await runAdvisor(ctx, params.question, params.context, params.includeRecentSession ?? true, (_chunk, output) => {
				onUpdate?.({ content: [{ type: "text", text: previewLines(output, 12).join("\n") }], details: {} });
			});
			return {
				content: [{ type: "text", text: result.output || "(advisor returned no output)" }],
				details: { model: result.model, promptPath: result.promptPath },
			};
		},
	});

	const showAdvisorConfig = async (ctx: ExtensionContext) => {
		const config = await loadAdvisorConfig(ctx);
		const message = [
			`Global: ${getGlobalConfigPath()}`,
			`Project: ${getProjectConfigPath(ctx.cwd)}${isProjectTrusted(ctx) ? "" : " (ignored; project not trusted)"}`,
			"",
			JSON.stringify(config, null, 2),
		].join("\n");
		ctx.ui.notify(message, "info");
	};

	const runAdvisorSetup = async (args: string, ctx: ExtensionContext) => {
			const input = (ctx.ui as any).input as ((prompt: string, placeholder?: string) => Promise<string | undefined>) | undefined;
			const project = args.split(/\s+/).includes("--project");
			const path = project ? getProjectConfigPath(ctx.cwd) : getGlobalConfigPath();
			if (project && !isProjectTrusted(ctx)) {
				ctx.ui.notify("Project is not trusted; refusing to write project .pi/advisor.json.", "warning");
				return;
			}

			const existingConfig = await readConfigObjectIfExists(path);
			const currentModel = currentModelArg(ctx);
			const models = await listAvailableModels(ctx.cwd);
			const modelChoices = [...(currentModel ? [`Use current model (${currentModel})`] : []), ...models, "Enter manually", "Cancel"];
			const modelChoice = await autocompleteSelect(ctx, {
				title: "Advisor model",
				items: modelChoices.map((choice) => ({ value: choice, label: choice })),
				maxVisible: 12,
				noMatchText: "  No matching models",
			});
			if (!modelChoice || modelChoice === "Cancel") {
				ctx.ui.notify("Advisor setup cancelled.", "info");
				return;
			}

			let model: string | undefined;
			if (modelChoice === "Enter manually") {
				if (!input) {
					ctx.ui.notify("Manual model entry requires a UI input prompt, but this Pi build does not expose one.", "warning");
					return;
				}
				model = (await input("Advisor model", "provider/model-id"))?.trim();
				if (!model) {
					ctx.ui.notify("Advisor setup cancelled.", "info");
					return;
				}
			} else if (modelChoice.startsWith("Use current model (")) {
				model = currentModel;
			} else {
				model = modelChoice;
			}

			const thinkingChoice = await autocompleteSelect(ctx, {
				title: "Advisor thinking level",
				items: ["Default", ...THINKING_LEVELS, "Cancel"].map((choice) => ({ value: choice, label: choice })),
				maxVisible: THINKING_LEVELS.length + 2,
			});
			if (!thinkingChoice || thinkingChoice === "Cancel") {
				ctx.ui.notify("Advisor setup cancelled.", "info");
				return;
			}

			const nextConfig = {
				...(existingConfig ?? {}),
				...(model ? { model } : {}),
				...(thinkingChoice === "Default" ? {} : { thinking: parseOptionalThinking(thinkingChoice, path) }),
				maxContextEntries: existingConfig?.maxContextEntries ?? 20,
				...(existingConfig?.systemPrompt ? {} : { systemPrompt: DEFAULT_SYSTEM_PROMPT }),
			};
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, JSON.stringify(nextConfig, null, 2) + "\n", "utf8");
			ctx.ui.notify(`${existingConfig ? "Updated" : "Created"} advisor config: ${path}`, "info");
		};

	const askAdvisorDirectly = async (question: string, ctx: ExtensionContext) => {
		setAdvisorStatus(ctx, "asking advisor...");
		try {
			const result = await runAdvisor(ctx, question, undefined, true);
			pi.sendMessage(
				{
					customType: "advisor-result",
					content: result.output || "(advisor returned no output)",
					display: true,
					details: { model: result.model, promptPath: result.promptPath },
				},
				{ triggerTurn: false },
			);
		} finally {
			setAdvisorStatus(ctx, undefined);
		}
	};

	pi.registerCommand("advisor", {
		description: "Advisor commands: ask <question>, setup [--project], config",
		getArgumentCompletions(prefix) {
			const items = [
				{ value: "ask ", label: "ask", description: "Ask the configured advisor model directly" },
				{ value: "setup", label: "setup", description: "Interactively create or update advisor config" },
				{ value: "setup --project", label: "setup --project", description: "Create or update project advisor config" },
				{ value: "config", label: "config", description: "Show resolved advisor config" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const input = args.trim();
			const [command, ...rest] = input.split(/\s+/);
			if (!input) {
				ctx.ui.notify("Usage: /advisor ask <question> | /advisor setup [--project] | /advisor config", "warning");
				return;
			}
			if (command === "config") return showAdvisorConfig(ctx);
			if (command === "setup") return runAdvisorSetup(rest.join(" "), ctx);
			const question = command === "ask" ? rest.join(" ").trim() : input;
			if (!question) {
				ctx.ui.notify("Usage: /advisor ask <question>", "warning");
				return;
			}
			await askAdvisorDirectly(question, ctx);
		},
	});

}
