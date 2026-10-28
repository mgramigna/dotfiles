import type { CouncilConfig } from "./config.ts";

export interface CouncilProgress {
	scope: string;
	phase: "starting" | "reviewing" | "debating" | "cancelling" | "complete" | "incomplete";
	startedAt: number;
	finishedAt?: number;
	round: number;
	maxRounds: number;
	accepted: number;
	pending: number;
	runDir?: string;
	members: {
		name: string;
		model: string;
		status: "waiting" | "working" | "submitted";
		activity: string;
		tools: number;
		turns: number;
		tokens: number;
		cost: number;
	}[];
}

export function createProgress(scope: string, config: CouncilConfig): CouncilProgress {
	return {
		scope, phase: "starting", startedAt: Date.now(), round: 0, maxRounds: config.maxDebateRounds,
		accepted: 0, pending: 0,
		members: config.members.map((member) => ({ ...member, status: "waiting", activity: "Waiting to start", tools: 0, turns: 0, tokens: 0, cost: 0 })),
	};
}

// Never show free-form commands, grep patterns, submission arguments, model prose or thinking.
// They may contain tentative findings or secrets. Paths and allowlisted command names give safe activity hints.
export function inspectionActivity(tool: string, args: Record<string, unknown>): string {
	if (tool === "council_submit") return "Submitting review";
	if (tool === "read") return typeof args.path === "string" ? `Reading ${args.path}` : "Reading source";
	if (tool === "grep") return "Searching source";
	if (tool === "find" || tool === "ls") return "Locating files";
	if (tool === "bash") {
		const command = typeof args.command === "string" ? args.command.trim() : "";
		const git = /^git\s+(diff|show|log|blame|status|rev-parse|merge-base|ls-files)(?:\s|$)/.exec(command);
		if (git) return `Inspecting repository · git ${git[1]}`;
		const gh = /^gh\s+(pr\s+(view|diff)|api)(?:\s|$)/.exec(command);
		if (gh) return `Inspecting pull request · gh ${gh[1]}`;
		return "Inspecting repository with bash";
	}
	return "Inspecting source";
}
