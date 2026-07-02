import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

interface SpawnParams {
	branch: string;
	prompt?: string;
	base?: string;
	workspaceLabel?: string;
	agentName?: string;
	focus?: boolean;
}

function timestampSlug(): string {
	return new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
}

function sanitizeBranch(value: string): string {
	return value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._\/-]/g, "-").replace(/-+/g, "-").replace(/^[-/]+|[-/]+$/g, "");
}

function shellishSplit(input: string): string[] {
	const matches = input.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
	return matches.map((part) => {
		if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
			return part.slice(1, -1).replace(/\\(["'])/g, "$1");
		}
		return part;
	});
}

async function execJson(command: string, args: string[], cwd: string): Promise<any> {
	const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 2 * 1024 * 1024, timeout: 15_000 });
	const text = stdout.trim();
	return text ? JSON.parse(text) : {};
}

function workspaceId(payload: any): string | undefined {
	return payload?.result?.workspace?.workspace_id
		?? payload?.result?.workspace?.id
		?? payload?.workspace?.workspace_id
		?? payload?.workspace?.id
		?? payload?.result?.workspace_id
		?? payload?.workspace_id
		?? payload?.id;
}

function worktreePath(payload: any): string | undefined {
	return payload?.result?.worktree?.path
		?? payload?.result?.worktree?.worktree_path
		?? payload?.result?.worktree_path
		?? payload?.result?.path
		?? payload?.worktree?.path
		?? payload?.worktree?.worktree_path
		?? payload?.worktree_path
		?? payload?.path;
}

function modelArg(ctx: ExtensionContext): string | undefined {
	const model = (ctx as any).model;
	if (!model?.id) return undefined;
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

async function spawnWorktrunkPi(ctx: ExtensionContext, params: SpawnParams) {
	const branch = sanitizeBranch(params.branch);
	if (!branch) throw new Error("A branch name is required.");

	const workspaceLabel = params.workspaceLabel || `pi ${branch}`;
	const workspace = await execJson("herdr", ["workspace", "create", "--cwd", ctx.cwd, "--label", workspaceLabel, params.focus === false ? "--no-focus" : "--focus"], ctx.cwd);
	const id = workspaceId(workspace);
	if (!id) throw new Error(`Could not find workspace id in herdr response: ${JSON.stringify(workspace)}`);

	const wtArgs = ["-y", "switch", "--create", "--format", "json", "--base", params.base || "^"];
	wtArgs.push(branch);
	const switched = await execJson("wt", wtArgs, ctx.cwd);
	const path = worktreePath(switched);
	if (!path) throw new Error(`Could not find worktree path in wt response: ${JSON.stringify(switched)}`);

	const agentName = params.agentName || `pi:${branch}`;
	const selectedModel = modelArg(ctx);
	const piArgs = selectedModel ? ["pi", "--model", selectedModel] : ["pi"];
	if (params.prompt?.trim()) piArgs.push(params.prompt.trim());

	const args = ["agent", "start", agentName, "--cwd", path, "--workspace", id, params.focus === false ? "--no-focus" : "--focus", "--", ...piArgs];
	const started = await execJson("herdr", args, ctx.cwd);
	return { workspaceId: id, workspaceLabel, agentName, branch, worktreePath: path, switched, started };
}

const HELP = `Usage:
/trunk <branch> [prompt...]
/trunk --base <ref> --label <workspace label> --no-focus <branch> [prompt...]

Creates a new Herdr workspace, asks Work Trunk to create/switch the worktree with JSON output, then starts Pi in Herdr with --cwd set to the created worktree. By default, branches are created from Work Trunk's default-branch shortcut (^), which resolves per-project (for example dev in some repos, main in others).

This avoids Work Trunk shell-integration directory-change warnings in non-interactive Herdr agent startup.`;

function parseCommandArgs(args: string): SpawnParams {
	const tokens = shellishSplit(args);
	const params: SpawnParams = { branch: "" };
	const rest: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "--base") params.base = tokens[++i];
		else if (token === "--label" || token === "--workspace-label") params.workspaceLabel = tokens[++i];
		else if (token === "--name" || token === "--agent-name") params.agentName = tokens[++i];
		else if (token === "--no-focus") params.focus = false;
		else if (token === "--focus") params.focus = true;
		else rest.push(token);
	}
	params.branch = rest.shift() || `pi/${timestampSlug()}`;
	params.prompt = rest.join(" ");
	return params;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("trunk", {
		description: "Create a Herdr workspace, Work Trunk worktree, and launch Pi there",
		handler: async (args: string, ctx: ExtensionContext) => {
			if (["help", "--help", "-h"].includes(args.trim())) {
				ctx.ui.notify(HELP, "info");
				return;
			}
			try {
				const result = await spawnWorktrunkPi(ctx, parseCommandArgs(args));
				ctx.ui.notify(`Started ${result.agentName} in Herdr workspace ${result.workspaceId} on branch ${result.branch}.`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not spawn Work Trunk Pi workspace: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "spawn_worktrunk_pi_workspace",
		label: "Spawn Work Trunk Pi workspace",
		description: "Create a new Herdr workspace, use Work Trunk to create/switch to a git worktree there, then launch pi in that worktree.",
		parameters: Type.Object({
			branch: Type.String({ description: "New branch/worktree name to create with wt switch --create." }),
			prompt: Type.Optional(Type.String({ description: "Optional initial prompt passed to pi after wt creates/switches to the worktree." })),
			base: Type.Optional(Type.String({ description: "Optional base ref for wt switch --create --base." })),
			workspaceLabel: Type.Optional(Type.String({ description: "Optional Herdr workspace label." })),
			agentName: Type.Optional(Type.String({ description: "Optional Herdr agent name." })),
			focus: Type.Optional(Type.Boolean({ description: "Focus the new workspace/agent. Defaults to true." })),
		}),
		async execute(_toolCallId, params: SpawnParams, _signal, _onUpdate, ctx) {
			const result = await spawnWorktrunkPi(ctx, params);
			return { content: [{ type: "text", text: `Started ${result.agentName} in workspace ${result.workspaceId} on branch ${result.branch}.` }], details: result };
		},
	});
}
