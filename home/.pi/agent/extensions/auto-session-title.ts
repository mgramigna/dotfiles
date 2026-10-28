import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPreferredModel } from "../shared/model-prefs";
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
	const preferred = await getPreferredModel(ctx, "small");
	if (!preferred) return undefined;

	const response = await complete(
		preferred.model,
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
			apiKey: preferred.auth.apiKey,
			headers: preferred.auth.headers,
			reasoningEffort: preferred.reasoningEffort,
		},
	);

	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");

	return cleanTitle(text);
}

export async function renameHerdrTab(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	title: string,
	isCurrent: () => boolean,
): Promise<void> {
	const tabId = process.env.HERDR_TAB_ID;
	// Headless child agents inherit Herdr's environment but must not rename their parent's tab.
	if (ctx.mode !== "tui" || process.env.HERDR_ENV !== "1" || !tabId || !isCurrent()) return;

	try {
		await pi.exec("herdr", ["tab", "rename", tabId, title], { timeout: 2_000 });
	} catch {
		// Missing Herdr, stale tab IDs, and API failures must not interrupt Pi.
	}
}

export async function renameHerdrWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	title: string,
	isCurrent: () => boolean,
): Promise<void> {
	const workspaceId = process.env.HERDR_WORKSPACE_ID;
	// Headless child agents inherit Herdr's environment but must not rename their parent's workspace.
	if (ctx.mode !== "tui" || process.env.HERDR_ENV !== "1" || !workspaceId || !isCurrent()) return;

	try {
		const result = await pi.exec("herdr", ["workspace", "get", workspaceId], { timeout: 2_000 });
		if (result.code !== 0 || !isCurrent()) return;
		const workspace = JSON.parse(result.stdout)?.result?.workspace;
		// Use checkout provenance, not the branch name: a primary checkout can be on any branch.
		if (workspace?.workspace_id !== workspaceId || workspace?.worktree?.is_linked_worktree !== true) return;
		await pi.exec("herdr", ["workspace", "rename", workspaceId, title], { timeout: 2_000 });
	} catch {
		// Missing Herdr, stale workspace IDs, and API failures must not interrupt Pi.
	}
}

export default function (pi: ExtensionAPI) {
	let attemptedForSession: string | undefined;
	let alive = true;
	let sessionGeneration = 0;

	pi.on("session_start", (_event, _ctx) => {
		alive = true;
		sessionGeneration += 1;
		attemptedForSession = undefined;
	});

	pi.on("session_shutdown", () => {
		alive = false;
		sessionGeneration += 1;
	});

	pi.on("before_agent_start", (event, ctx) => {
		const sessionFile = ctx.sessionManager.getSessionFile() ?? "<memory>";
		if (attemptedForSession === sessionFile) return;
		if (pi.getSessionName()) return;
		if (!isFirstUserPrompt(ctx)) return;

		attemptedForSession = sessionFile;
		const prompt = event.prompt.trim();
		if (!prompt) return;

		const generation = sessionGeneration;
		const isCurrent = () => alive && generation === sessionGeneration;
		void (async () => {
			try {
				const title = await generateTitle(prompt, ctx);
				if (!isCurrent() || !title || pi.getSessionName()) return;
				pi.setSessionName(title);
				await renameHerdrTab(pi, ctx, title, isCurrent);
				await renameHerdrWorktree(pi, ctx, title, isCurrent);
			} catch {
				// Fail safe: never interrupt the turn and never rename on errors.
			}
		})();
	});
}
