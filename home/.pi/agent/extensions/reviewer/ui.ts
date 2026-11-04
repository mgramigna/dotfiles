import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import type { ReviewMode } from "./options.ts";

export interface ReviewProgress {
	mode: ReviewMode;
	scope: string;
	model: string;
	requestedThinking: ThinkingLevel;
	thinking?: ThinkingLevel;
	phase: "starting" | "reviewing" | "cancelling" | "complete" | "incomplete";
	startedAt: number;
	finishedAt?: number;
	activity: string;
	recent: string[];
	tools: number;
	turns: number;
	tokens: number;
	cost: number;
}
export interface ReviewResultDetails {
	progress: ReviewProgress;
	runDir?: string;
	coverage?: "complete" | "partial" | "unavailable";
	findingTitles: string[];
	claimCounts?: { supported: number; contradicted: number; unresolved: number };
	workspaceChanged?: boolean;
}
export interface ReviewResult { report: string; details: ReviewResultDetails }

export function createProgress(scope: string, model: string, thinking: ThinkingLevel, mode: ReviewMode = "verify"): ReviewProgress {
	return { mode, scope, model, requestedThinking: thinking, phase: "starting", startedAt: Date.now(), activity: mode === "verify" ? "Preparing isolated verifier" : "Preparing isolated reviewer", recent: [], tools: 0, turns: 0, tokens: 0, cost: 0 };
}
export function singleLine(value: string): string {
	return stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
}
function duration(progress: ReviewProgress, now: number): string {
	const seconds = Math.max(0, Math.floor(((progress.finishedAt ?? now) - progress.startedAt) / 1000));
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
function reasoning(progress: ReviewProgress): string {
	if (!progress.thinking) return `${progress.requestedThinking} requested`;
	return progress.thinking === progress.requestedThinking ? progress.thinking : `${progress.thinking} (${progress.requestedThinking} requested)`;
}

// Never put raw shell commands, grep patterns, model thinking or draft findings in the live panel.
export function inspectionActivity(tool: string, args: Record<string, unknown>): string {
	if (tool === "reviewer_submit") return "Submitting report";
	if (tool === "read") return typeof args.path === "string" ? `Read ${args.path}` : "Read source";
	if (tool === "grep") return "Search source";
	if (tool === "find" || tool === "ls") return "Locate files";
	if (tool === "bash") {
		const command = typeof args.command === "string" ? args.command.trim() : "";
		const match = /^(git\s+(?:diff|show|log|blame|status|rev-parse|merge-base|ls-files)|but\s+(?:diff|show|status)|gh\s+pr\s+(?:view|diff))(?:\s|$)/.exec(command);
		return match ? `Inspect · ${match[1]}` : "Inspect with bash";
	}
	return `Inspect · ${tool}`;
}

export function renderProgress(progress: ReviewProgress, theme: Theme, width: number, now = Date.now(), pending = false): string[] {
	const phase = { starting: "Starting", reviewing: "Investigating", cancelling: "Cancelling", complete: "Complete", incomplete: "Incomplete" }[progress.phase];
	const tokens = progress.tokens >= 1000 ? `${(progress.tokens / 1000).toFixed(1)}k` : String(progress.tokens);
	const lines = [
		theme.fg("accent", `╭─ ${progress.mode === "verify" ? "Verifier" : "Adversarial reviewer"} · ${phase} · ${duration(progress, now)}`),
		`${theme.fg("accent", "│")} ${theme.fg("muted", singleLine(progress.scope))}`,
		`${theme.fg("accent", "│")} ${singleLine(progress.model)} · ${reasoning(progress)}`,
		`${theme.fg("accent", "│")} ${progress.tools} tools · ${progress.turns} turns · ${tokens} tokens${progress.cost > 0 ? ` · $${progress.cost.toFixed(3)}` : ""}`,
	];
	for (const item of progress.recent.slice(-3)) lines.push(`${theme.fg("accent", "│")} ${theme.fg("dim", singleLine(item))}`);
	lines.push(`${theme.fg("accent", "│")} ${theme.fg("muted", singleLine(progress.activity))}`);
	if (pending) lines.push(`${theme.fg("accent", "│")} Report saved. It will appear in chat when the current response finishes.`);
	lines.push(theme.fg("accent", "╰─ ") + theme.fg("dim", "/review status · /review hide · /review cancel"));
	return lines.map((line) => truncateToWidth(line, width));
}

export function resultComponent(report: string, details: ReviewResultDetails | undefined, expanded: boolean, theme: Theme) {
	const markdown = new Markdown(report, 0, 0, getMarkdownTheme());
	return {
		render(width: number): string[] {
			if (expanded) return markdown.render(width);
			const incomplete = details?.progress.phase !== "complete";
			const needsAttention = incomplete || !!details?.findingTitles.length || !!details?.claimCounts?.contradicted || !!details?.claimCounts?.unresolved;
			const label = details?.progress.mode === "verify" ? "Verification" : "Review";
			const lines = [theme.fg(needsAttention ? "warning" : "success", theme.bold(`${label} ${incomplete ? "incomplete" : "complete"}`))];
			if (details) {
				lines.push(singleLine(`${details.progress.model} · ${reasoning(details.progress)} · ${duration(details.progress, Date.now())}`));
				lines.push(singleLine(details.progress.scope));
				if (details.coverage) lines.push(`Coverage: ${details.coverage} · ${details.findingTitles.length} finding(s)`);
				if (details.claimCounts) {
					const { supported, contradicted, unresolved } = details.claimCounts;
					lines.push(`Claims: ${supported} supported · ${contradicted} contradicted · ${unresolved} unresolved`);
				}
				lines.push(...details.findingTitles.slice(0, 3).map(singleLine));
				if (details.findingTitles.length > 3) lines.push(`... ${details.findingTitles.length - 3} more finding(s)`);
				if (details.workspaceChanged) lines.push(theme.fg("warning", "Workspace changes detected during review"));
			}
			lines.push(theme.fg("dim", "Ctrl+O to expand"));
			if (details?.runDir) lines.push(theme.fg("dim", singleLine(details.runDir)));
			return lines.map((line) => truncateToWidth(line, width));
		},
		invalidate() { markdown.invalidate(); },
	};
}
