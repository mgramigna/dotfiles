import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ReasoningEffort = Exclude<ThinkingLevel, "off" | "xhigh" | "max">;

export interface ModelPreference {
	provider: string;
	modelId: string;
	reasoningEffort?: ReasoningEffort;
}

export interface ResolvedModelPreference extends ModelPreference {
	model: NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;
	auth: {
		apiKey: string;
		headers?: Record<string, string>;
	};
}

type ModelPrefsFile = Record<string, unknown>;

export const MODEL_PREFS_PATH = join(getAgentDir(), "model-prefs.json");

export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const satisfies readonly ReasoningEffort[];

function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

function parseModelPreference(value: unknown): ModelPreference | undefined {
	if (!value || typeof value !== "object") return undefined;

	const candidate = value as Record<string, unknown>;
	if (typeof candidate.provider !== "string" || typeof candidate.modelId !== "string") return undefined;
	if (candidate.reasoningEffort !== undefined && !isReasoningEffort(candidate.reasoningEffort)) return undefined;

	return {
		provider: candidate.provider,
		modelId: candidate.modelId,
		...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort } : {}),
	};
}

export async function readModelPreference(name: string): Promise<ModelPreference | undefined> {
	try {
		const raw = await readFile(MODEL_PREFS_PATH, "utf8");
		const prefs = JSON.parse(raw) as ModelPrefsFile;
		return parseModelPreference(prefs[name]);
	} catch {
		return undefined;
	}
}

export async function getPreferredModel(ctx: ExtensionContext, name: string): Promise<ResolvedModelPreference | undefined> {
	const preference = await readModelPreference(name);
	if (!preference) return undefined;

	const model = ctx.modelRegistry.find(preference.provider, preference.modelId);
	if (!model) return undefined;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return undefined;

	return {
		...preference,
		model,
		auth: {
			apiKey: auth.apiKey,
			headers: auth.headers,
		},
	};
}
