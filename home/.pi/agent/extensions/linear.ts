import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
	comments(first: 20) { nodes { id body createdAt user { id name email } } }
`;

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
		name: "linear_update_issue",
		label: "Linear: Update Issue",
		description: "Update a Linear issue title, description, priority, assigneeId, or stateId by issue key.",
		parameters: Type.Object({
			issueKey: Type.String({ description: "Linear issue key, e.g. DEV-123" }),
			title: Type.Optional(Type.String()),
			description: Type.Optional(Type.String({ description: "Markdown issue description" })),
			priority: Type.Optional(Type.Number()),
			assigneeId: Type.Optional(Type.String()),
			stateId: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params) {
			const issue = await getIssueByKey(params.issueKey);
			const input: Record<string, unknown> = {};
			for (const key of ["title", "description", "priority", "assigneeId", "stateId"] as const) {
				if (params[key] !== undefined) input[key] = params[key];
			}
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
		description: "Add a markdown comment to a Linear issue by issue key.",
		parameters: Type.Object({
			issueKey: Type.String({ description: "Linear issue key, e.g. DEV-123" }),
			body: Type.String({ description: "Markdown comment body" }),
		}),
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

	pi.registerCommand("linear", {
		description: "Check Linear extension setup",
		handler: async (_args, ctx) => {
			try {
				apiKey();
				ctx.ui.notify("Linear extension ready", "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Linear extension is not configured", "warning");
			}
		},
	});

	pi.registerCommand("linear-login", {
		description: "Save a Linear API key to ~/.pi/agent/linear.json",
		handler: async (_args, ctx) => {
			const key = (await ctx.ui.input("Linear API key:", "lin_api_..."))?.trim();
			if (!key) {
				ctx.ui.notify("Linear API key was not saved", "warning");
				return;
			}
			writeGlobalApiKey(key);
			ctx.ui.notify(`Saved Linear API key to ${globalConfigPath}`, "info");
		},
	});
}
