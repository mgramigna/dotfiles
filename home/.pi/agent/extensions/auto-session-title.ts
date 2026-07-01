import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.4-mini";
const MAX_PROMPT_CHARS = 4_000;
const MAX_TITLE_CHARS = 60;

function isFirstUserPrompt(ctx: ExtensionContext): boolean {
	const userMessages = ctx.sessionManager
		.getBranch()
		.filter((entry) => entry.type === "message" && entry.message?.role === "user");

	// before_agent_start may run before or after the current user message is persisted,
	// depending on pi internals/version. Treat 0 or 1 user messages as the initial prompt.
	return userMessages.length <= 1;
}

function cleanTitle(raw: string): string | undefined {
	const firstLine = raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);

	if (!firstLine) return undefined;

	const title = firstLine
		.replace(/^[-*#\s"'`]+/, "")
		.replace(/["'`.\s]+$/, "")
		.replace(/\s+/g, " ")
		.trim();

	if (!title) return undefined;
	return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS).replace(/[\s,;:–—-]+$/, "") : title;
}

async function generateTitle(prompt: string, ctx: ExtensionContext): Promise<string | undefined> {
	const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
	if (!model) return undefined;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return undefined;

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [
						{
							type: "text" as const,
							text: `Create a terse, helpful session title for this coding-agent prompt.\n\nRules:\n- 2-6 words\n- No quotes\n- No markdown\n- Title case is optional\n- Return only the title\n\nPrompt:\n${prompt.slice(0, MAX_PROMPT_CHARS)}`,
						},
					],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			reasoningEffort: "low",
		},
	);

	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");

	return cleanTitle(text);
}

export default function (pi: ExtensionAPI) {
	let attemptedForSession: string | undefined;
	let alive = true;

	pi.on("session_start", (_event, _ctx) => {
		alive = true;
		attemptedForSession = undefined;
	});

	pi.on("session_shutdown", () => {
		alive = false;
	});

	pi.on("before_agent_start", (event, ctx) => {
		const sessionFile = ctx.sessionManager.getSessionFile() ?? "<memory>";
		if (attemptedForSession === sessionFile) return;
		if (pi.getSessionName()) return;
		if (!isFirstUserPrompt(ctx)) return;

		attemptedForSession = sessionFile;
		const prompt = event.prompt.trim();
		if (!prompt) return;

		void (async () => {
			try {
				const title = await generateTitle(prompt, ctx);
				if (!alive || !title || pi.getSessionName()) return;
				pi.setSessionName(title);
			} catch {
				// Fail safe: never interrupt the turn and never rename on errors.
			}
		})();
	});
}
