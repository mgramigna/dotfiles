import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearResponse<T> {
	data?: T;
	errors?: Array<{ message: string }>;
}

interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description?: string | null;
	url: string;
	priority?: number | null;
	state?: { id: string; name: string; type?: string | null } | null;
	team?: { id: string; key: string; name: string } | null;
	assignee?: { id: string; name: string; email?: string | null } | null;
	creator?: { id: string; name: string; email?: string | null } | null;
	labels?: { nodes?: Array<{ id: string; name: string }> } | null;
	parent?: { id: string; identifier: string; title: string; url: string } | null;
	children?: {
		nodes?: Array<{
			id: string;
			identifier: string;
			title: string;
			url: string;
			state?: { id: string; name: string; type?: string | null } | null;
		}>;
	} | null;
	comments?: {
		nodes?: Array<{
			id: string;
			body: string;
			createdAt: string;
			user?: { id: string; name: string; email?: string | null } | null;
		}>;
	} | null;
	createdAt: string;
	updatedAt: string;
}

const globalConfigPath = join(homedir(), ".pi", "agent", "linear.json");

function readJsonApiKey(path: string): string | null {
	if (!existsSync(path)) return null;
	const data = JSON.parse(readFileSync(path, "utf8")) as { apiKey?: string; key?: string };
	return data.apiKey || data.key || null;
}

function writeGlobalApiKey(key: string): void {
	const dir = join(homedir(), ".pi", "agent");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(globalConfigPath, `${JSON.stringify({ apiKey: key }, null, "\t")}\n`, { mode: 0o600 });
}

function apiKey(): string {
	const key =
		process.env.LINEAR_API_KEY ||
		readJsonApiKey(globalConfigPath) ||
		readJsonApiKey(join(process.cwd(), ".pi", "linear.json"));
	if (!key) {
		throw new Error(
			"Linear API key is not configured. Set LINEAR_API_KEY or create ~/.pi/agent/linear.json with { \"apiKey\": \"lin_api_...\" }.",
		);
	}
	return key;
}

async function linearGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
	const response = await fetch(LINEAR_API_URL, {
		method: "POST",
		headers: {
			Authorization: apiKey(),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});

	const payload = (await response.json()) as LinearResponse<T>;
	if (!response.ok || payload.errors?.length) {
		throw new Error(payload.errors?.map((error) => error.message).join("; ") || `Linear HTTP ${response.status}`);
	}
	if (!payload.data) throw new Error("Linear returned no data");
	return payload.data;
}

function parseIssueKey(issueKey: string): { teamKey: string; number: number } {
	const match = issueKey.trim().toUpperCase().match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
	if (!match) throw new Error(`Invalid Linear issue key: ${issueKey}`);
	return { teamKey: match[1]!, number: Number(match[2]) };
}

const issueFields = `
	id
	identifier
	title
	description
	url
	priority
	createdAt
	updatedAt
	state { id name type }
	team { id key name }
	assignee { id name email }
	creator { id name email }
	labels { nodes { id name } }
	parent { id identifier title url }
	children(first: 20) { nodes { id identifier title url state { id name type } } }
	comments(first: 20) { nodes { id body createdAt user { id name email } } }
`;

const linearAddCommentParameters = Type.Object({
	issueKey: Type.String({ description: "Linear issue key, e.g. DEV-123" }),
	body: Type.String({ description: "Markdown comment body" }),
});
type LinearAddCommentInput = Static<typeof linearAddCommentParameters>;

const COMMENT_PREVIEW_LIMIT = 2_000;

function commentPreview(body: string): string {
	if (body.length <= COMMENT_PREVIEW_LIMIT) return body;
	return `${body.slice(0, COMMENT_PREVIEW_LIMIT)}\n\n[… ${body.length - COMMENT_PREVIEW_LIMIT} more characters]`;
}

async function getIssueByKey(issueKey: string): Promise<LinearIssue> {
	const { teamKey, number } = parseIssueKey(issueKey);
	const data = await linearGraphql<{
		issues: { nodes?: LinearIssue[] };
	}>(
		`query($teamKey: String!, $number: Float!) {
			issues(first: 1, filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
				nodes { ${issueFields} }
			}
		}`,
		{ teamKey, number },
	);

	const issue = data.issues.nodes?.[0];
	if (!issue) throw new Error(`Linear issue ${issueKey} not found`);
	return issue;
}

function formatIssue(issue: LinearIssue): string {
	const labels = issue.labels?.nodes?.map((label) => label.name).join(", ") || "none";
	const parent = issue.parent ? `${issue.parent.identifier}: ${issue.parent.title} (${issue.parent.url})` : "none";
	const children = issue.children?.nodes?.length
		? issue.children.nodes
				.map((child) => `- ${child.identifier}: ${child.title} [${child.state?.name || "unknown"}] (${child.url})`)
				.join("\n")
		: "none";
	const comments = issue.comments?.nodes?.length
		? issue.comments.nodes
				.map((comment) => `- ${comment.user?.name || "Unknown"} (${comment.createdAt}):\n${comment.body}`)
				.join("\n\n")
		: "none";

	return [
		`${issue.identifier}: ${issue.title}`,
		`URL: ${issue.url}`,
		`Team: ${issue.team?.name || "unknown"} (${issue.team?.key || "?"})`,
		`State: ${issue.state?.name || "unknown"}`,
		`Assignee: ${issue.assignee?.name || "unassigned"}`,
		`Priority: ${issue.priority ?? "none"}`,
		`Labels: ${labels}`,
		`Parent: ${parent}`,
		"Sub-issues:",
		children,
		`Created: ${issue.createdAt}`,
		`Updated: ${issue.updatedAt}`,
		"",
		"Description:",
		issue.description || "(none)",
		"",
		"Recent comments:",
		comments,
	].join("\n");
}

async function resolveTeamId(teamKeyOrId: string): Promise<string> {
	if (/^[0-9a-f-]{20,}$/i.test(teamKeyOrId)) return teamKeyOrId;
	const data = await linearGraphql<{ teams: { nodes?: Array<{ id: string; key: string; name: string }> } }>(
		`query($key: String!) { teams(first: 1, filter: { key: { eq: $key } }) { nodes { id key name } } }`,
		{ key: teamKeyOrId.toUpperCase() },
	);
	const team = data.teams.nodes?.[0];
	if (!team) throw new Error(`Linear team ${teamKeyOrId} not found`);
	return team.id;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType<"linear_add_comment", LinearAddCommentInput>("linear_add_comment", event)) {
			return undefined;
		}

		if (!ctx.hasUI) {
			return { block: true, reason: "Linear comment blocked (no UI for confirmation)" };
		}

		const confirmed = await ctx.ui.confirm(
			`Add comment to ${event.input.issueKey}?`,
			`This will post the following comment to Linear:\n\n${commentPreview(event.input.body)}\n\nAllow this one time?`,
		);
		if (!confirmed) return { block: true, reason: "Linear comment blocked by user" };

		return undefined;
	});

	pi.registerTool({
		name: "linear_get_issue",
		label: "Linear: Get Issue",
		description: "Read a Linear issue by issue key such as DEV-123, including description and recent comments.",
		parameters: Type.Object({ issueKey: Type.String({ description: "Linear issue key, e.g. DEV-123" }) }),
		async execute(_toolCallId, params) {
			const issue = await getIssueByKey(params.issueKey);
			return { content: [{ type: "text", text: formatIssue(issue) }], details: issue };
		},
	});

	pi.registerTool({
		name: "linear_create_issue",
		label: "Linear: Create Issue",
		description: "Create a Linear issue. Provide a team key (e.g. DEV) or team id, title, and optional markdown description.",
		parameters: Type.Object({
			teamKeyOrId: Type.String({ description: "Linear team key, e.g. DEV, or a team id" }),
			title: Type.String(),
			description: Type.Optional(Type.String({ description: "Markdown issue description" })),
			priority: Type.Optional(Type.Number({ description: "Linear priority number, if desired" })),
		}),
		async execute(_toolCallId, params) {
			const teamId = await resolveTeamId(params.teamKeyOrId);
			const data = await linearGraphql<{ issueCreate: { success: boolean; issue?: LinearIssue } }>(
				`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${issueFields} } } }`,
				{ input: { teamId, title: params.title, description: params.description, priority: params.priority } },
			);
			if (!data.issueCreate.success || !data.issueCreate.issue) throw new Error("Linear issueCreate failed");
			return { content: [{ type: "text", text: formatIssue(data.issueCreate.issue) }], details: data.issueCreate.issue };
		},
	});

	pi.registerTool({
		name: "linear_create_subissue",
		label: "Linear: Create Sub-issue",
		description: "Create a Linear sub-issue under an existing parent issue key such as DEV-123.",
		parameters: Type.Object({
			parentIssueKey: Type.String({ description: "Parent Linear issue key, e.g. DEV-123" }),
			title: Type.String(),
			description: Type.Optional(Type.String({ description: "Markdown issue description" })),
			priority: Type.Optional(Type.Number({ description: "Linear priority number, if desired. Defaults to Linear's sub-issue inheritance behavior." })),
			assigneeId: Type.Optional(Type.String()),
			stateId: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params) {
			const parent = await getIssueByKey(params.parentIssueKey);
			if (!parent.team?.id) throw new Error(`Linear parent issue ${parent.identifier} has no team`);
			const input: Record<string, unknown> = {
				teamId: parent.team.id,
				parentId: parent.id,
				title: params.title,
				description: params.description,
			};
			for (const key of ["priority", "assigneeId", "stateId"] as const) {
				if (params[key] !== undefined) input[key] = params[key];
			}
			const data = await linearGraphql<{ issueCreate: { success: boolean; issue?: LinearIssue } }>(
				`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${issueFields} } } }`,
				{ input },
			);
			if (!data.issueCreate.success || !data.issueCreate.issue) throw new Error("Linear issueCreate failed");
			return { content: [{ type: "text", text: formatIssue(data.issueCreate.issue) }], details: data.issueCreate.issue };
		},
	});

	pi.registerTool({
		name: "linear_update_issue",
		label: "Linear: Update Issue",
		description: "Update a Linear issue title, description, priority, assigneeId, stateId, or parentIssueKey by issue key.",
		parameters: Type.Object({
			issueKey: Type.String({ description: "Linear issue key, e.g. DEV-123" }),
			title: Type.Optional(Type.String()),
			description: Type.Optional(Type.String({ description: "Markdown issue description" })),
			priority: Type.Optional(Type.Number()),
			assigneeId: Type.Optional(Type.String()),
			stateId: Type.Optional(Type.String()),
			parentIssueKey: Type.Optional(Type.String({ description: "Parent Linear issue key to make this issue a sub-issue, e.g. DEV-123" })),
		}),
		async execute(_toolCallId, params) {
			const issue = await getIssueByKey(params.issueKey);
			const input: Record<string, unknown> = {};
			for (const key of ["title", "description", "priority", "assigneeId", "stateId"] as const) {
				if (params[key] !== undefined) input[key] = params[key];
			}
			if (params.parentIssueKey !== undefined) input.parentId = params.parentIssueKey;
			const data = await linearGraphql<{ issueUpdate: { success: boolean; issue?: LinearIssue } }>(
				`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${issueFields} } } }`,
				{ id: issue.id, input },
			);
			if (!data.issueUpdate.success || !data.issueUpdate.issue) throw new Error("Linear issueUpdate failed");
			return { content: [{ type: "text", text: formatIssue(data.issueUpdate.issue) }], details: data.issueUpdate.issue };
		},
	});

	pi.registerTool({
		name: "linear_add_comment",
		label: "Linear: Add Comment",
		description: "Add a markdown comment to a Linear issue by issue key. Requires explicit user confirmation before posting.",
		parameters: linearAddCommentParameters,
		async execute(_toolCallId, params) {
			const issue = await getIssueByKey(params.issueKey);
			const data = await linearGraphql<{ commentCreate: { success: boolean; comment?: { id: string; url?: string } } }>(
				`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }`,
				{ input: { issueId: issue.id, body: params.body } },
			);
			if (!data.commentCreate.success) throw new Error("Linear commentCreate failed");
			return {
				content: [{ type: "text", text: `Comment added to ${issue.identifier}${data.commentCreate.comment?.url ? `: ${data.commentCreate.comment.url}` : ""}` }],
				details: data.commentCreate,
			};
		},
	});

	const checkLinearSetup = (ctx: any) => {
		try {
			apiKey();
			ctx.ui.notify("Linear extension ready", "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : "Linear extension is not configured", "warning");
		}
	};

	const linearLogin = async (ctx: any) => {
		const key = (await ctx.ui.input("Linear API key:", "lin_api_..."))?.trim();
		if (!key) {
			ctx.ui.notify("Linear API key was not saved", "warning");
			return;
		}
		writeGlobalApiKey(key);
		ctx.ui.notify(`Saved Linear API key to ${globalConfigPath}`, "info");
	};

	pi.registerCommand("linear", {
		description: "Linear commands: status, login",
		getArgumentCompletions(prefix) {
			const items = [
				{ value: "status", label: "status", description: "Check Linear extension setup" },
				{ value: "login", label: "login", description: "Save a Linear API key" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const command = args.trim() || "status";
			if (command === "status") return checkLinearSetup(ctx);
			if (command === "login") return linearLogin(ctx);
			ctx.ui.notify("Usage: /linear status | /linear login", "warning");
		},
	});

}
