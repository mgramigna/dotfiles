import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import type { CouncilProgress } from "./progress.ts";

export function singleLine(value: string): string {
	return stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
}

function duration(progress: CouncilProgress, now: number): string {
	const seconds = Math.max(0, Math.floor(((progress.finishedAt ?? now) - progress.startedAt) / 1000));
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function tokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function renderProgress(progress: CouncilProgress, theme: Theme, width: number, now = Date.now()): string[] {
	const phase = { starting: "Starting", reviewing: "Independent review", debating: `Discussion ${progress.round}/${progress.maxRounds}`, cancelling: "Cancelling", complete: "Complete", incomplete: "Incomplete" }[progress.phase];
	const lines = [
		theme.fg("accent", `╭─ Council · ${phase} · ${duration(progress, now)}`),
		`${theme.fg("accent", "│")} ${theme.fg("muted", singleLine(progress.scope))}`,
	];
	for (const member of progress.members) {
		const status = member.status === "submitted" ? "submitted" : member.status === "working" ? "working" : "waiting";
		const model = member.model.slice(member.model.indexOf("/") + 1);
		lines.push(`${theme.fg("accent", "│")} ${theme.bold(singleLine(member.name))} ${theme.fg("dim", singleLine(model))} · ${theme.fg(member.status === "submitted" ? "success" : "muted", status)} · ${member.tools} ${member.tools === 1 ? "tool" : "tools"} · ${member.turns} ${member.turns === 1 ? "turn" : "turns"} · ${tokens(member.tokens)} tokens${member.cost > 0 ? ` · $${member.cost.toFixed(3)}` : ""}`);
		lines.push(`${theme.fg("accent", "│")}   ${theme.fg("dim", singleLine(member.activity))}`);
	}
	if (progress.phase === "debating") lines.push(`${theme.fg("accent", "│")} ${progress.pending} pending candidate(s) · findings stay hidden until agreement`);
	lines.push(theme.fg("accent", "╰─ ") + theme.fg("dim", "/council status · /council hide · /council cancel"));
	return lines.map((line) => truncateToWidth(line, width));
}

export interface CouncilResultDetails {
	runDir: string;
	incomplete: boolean;
	progress?: CouncilProgress;
}

export function resultComponent(report: string, details: CouncilResultDetails | undefined, expanded: boolean, theme: Theme) {
	const markdown = new Markdown(report, 0, 0, getMarkdownTheme());
	return {
		render(width: number): string[] {
			if (expanded) return markdown.render(width);
			const progress = details?.progress;
			const incomplete = details?.incomplete ?? report.includes("## Council review incomplete");
			const label = incomplete ? "Council review incomplete" : "Council review complete";
			const summary = progress && !incomplete ? `${progress.accepted} agreed finding(s) · ${progress.pending} unresolved` : "";
			const lines = [theme.fg(incomplete ? "warning" : "success", theme.bold(label)) + (progress ? theme.fg("dim", ` · ${duration(progress, Date.now())}`) : "")];
			if (summary) lines.push(summary);
			// Only final, unanimously accepted finding titles come from the report. Never render model drafts.
			const titles = report.split("\n").filter((line) => line.startsWith("### ["));
			for (const title of titles.slice(0, 3)) lines.push(singleLine(title.slice(4)));
			if (titles.length > 3) lines.push(`... ${titles.length - 3} more agreed finding(s)`);
			lines.push(theme.fg("dim", "Ctrl+O to expand · /council summary for the discussion"));
			if (details?.runDir) lines.push(theme.fg("dim", singleLine(details.runDir)));
			return lines.map((line) => truncateToWidth(line, width));
		},
		invalidate() { markdown.invalidate(); },
	};
}
