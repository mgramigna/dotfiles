import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { autocompleteSelect } from "../shared/autocomplete-select";
import { MODEL_PREFS_PATH, REASONING_EFFORTS, type ModelPreference, type ReasoningEffort } from "../shared/model-prefs";

function modelKey(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

function readPrefs(): Record<string, ModelPreference> {
	try {
		const parsed = JSON.parse(readFileSync(MODEL_PREFS_PATH, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, ModelPreference>) : {};
	} catch {
		return {};
	}
}

function writePrefs(prefs: Record<string, ModelPreference>): void {
	mkdirSync(dirname(MODEL_PREFS_PATH), { recursive: true });
	writeFileSync(MODEL_PREFS_PATH, `${JSON.stringify(prefs, null, "\t")}\n`, "utf8");
}

async function configurePreference(name: string, ctx: ExtensionCommandContext): Promise<void> {
	const models = ctx.modelRegistry.getAvailable();
	if (models.length === 0) throw new Error("No authenticated models are available. Run /login first.");

	const selectedModel = await autocompleteSelect(ctx, {
		title: `Select model for '${name}'`,
		items: models.map((model: Model<any>) => ({
			label: modelKey(model),
			value: modelKey(model),
			description: model.name,
		})),
	});
	if (!selectedModel) throw new Error("Setup cancelled");

	const [provider, ...modelParts] = selectedModel.split("/");
	const modelId = modelParts.join("/");
	const model = ctx.modelRegistry.find(provider!, modelId);
	if (!model) throw new Error(`Model not found: ${selectedModel}`);

	const selectedReasoning = await autocompleteSelect(ctx, {
		title: `Select reasoning effort for '${name}'`,
		items: [
			{ label: "None", value: "none", description: "Do not pass a reasoningEffort override" },
			...REASONING_EFFORTS.map((effort) => ({ label: effort, value: effort })),
		],
	});
	if (!selectedReasoning) throw new Error("Setup cancelled");

	const prefs = readPrefs();
	prefs[name] = {
		provider: model.provider,
		modelId: model.id,
		...(selectedReasoning === "none" ? {} : { reasoningEffort: selectedReasoning as ReasoningEffort }),
	};
	writePrefs(prefs);
	ctx.ui.notify(`Saved '${name}' model preference to ${MODEL_PREFS_PATH}`, "info");
}

function showConfig(ctx: ExtensionCommandContext): void {
	ctx.ui.notify(`${MODEL_PREFS_PATH}\n\n${JSON.stringify(readPrefs(), null, "\t")}`, "info");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("model-prefs", {
		description: "Configure shared model preferences: setup [name], config",
		getArgumentCompletions(prefix) {
			const items = [
				{ value: "setup small", label: "setup small", description: "Interactively configure the shared small model" },
				{ value: "setup ", label: "setup", description: "Interactively configure a named model preference" },
				{ value: "config", label: "config", description: "Show model preference config" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input || input === "setup") return configurePreference("small", ctx);
			if (input === "config") return showConfig(ctx);

			const [command, name, ...rest] = input.split(/\s+/);
			if (command === "setup" && name && rest.length === 0) return configurePreference(name, ctx);

			ctx.ui.notify("Usage: /model-prefs setup [name] | /model-prefs config", "warning");
		},
	});
}
