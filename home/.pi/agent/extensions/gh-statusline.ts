import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hyperlink } from "@earendil-works/pi-tui";

const exec = promisify(execFile);
const STATUS_KEY = "03-github-prs";
const REFRESH_INTERVAL_MS = 30_000;

interface Check {
	__typename: "CheckRun" | "StatusContext";
	status?: string;
	conclusion?: string | null;
	state?: string;
	workflowName?: string;
	detailsUrl?: string;
}

export interface PullRequest {
	number: number;
	url: string;
	statusCheckRollup: Check[] | null;
}

type Color = "success" | "error" | "warning" | "dim";

/** Rollups include obsolete workflow runs, even cancelled, unexpanded matrix jobs. */
function currentWorkflowChecks(checks: Check[]): Check[] {
	const latest = new Map<string, bigint>();
	const runs = checks.map(check => {
		if (check.__typename !== "CheckRun" || !check.workflowName) return undefined;
		const match = check.detailsUrl?.match(/^https:\/\/([^/]+\/[^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/|$)/);
		if (!match) return undefined;
		const key = `${match[1]}\n${check.workflowName}`;
		const id = BigInt(match[2]!);
		// Run IDs order newly created Actions runs. This is not attempt ordering:
		// rerunning an older run retains its ID. Same-run attempts remain untouched.
		if (!latest.has(key) || id > latest.get(key)!) latest.set(key, id);
		return { key, id };
	});
	return checks.filter((_check, index) => {
		const run = runs[index];
		return !run || latest.get(run.key) === run.id;
	});
}

export function checkSummary(checks: Check[] | null): { text: string; color: Color }[] {
	if (!checks?.length) return [{ text: "no checks", color: "dim" }];
	const counts = { passed: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 };
	for (const check of currentWorkflowChecks(checks)) {
		const state = check.__typename === "StatusContext" ? check.state
			: check.status === "COMPLETED" ? check.conclusion : check.status;
		if (state === "SUCCESS") counts.passed++;
		else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(state ?? "")) counts.failed++;
		else if (["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(state ?? "")) counts.pending++;
		else if (state === "SKIPPED" || state === "NEUTRAL") counts.skipped++;
		else counts.unknown++;
	}
	const parts: { text: string; color: Color }[] = [];
	if (counts.passed) parts.push({ text: `✓ ${counts.passed}`, color: "success" });
	if (counts.failed) parts.push({ text: `✗ ${counts.failed}`, color: "error" });
	if (counts.pending) parts.push({ text: `⏳ ${counts.pending}`, color: "warning" });
	if (counts.skipped) parts.push({ text: `skip ${counts.skipped}`, color: "dim" });
	if (counts.unknown) parts.push({ text: `? ${counts.unknown}`, color: "warning" });
	return parts;
}

export function renderPrs(prs: PullRequest[], fg: (color: Color | "accent", text: string) => string): string {
	const count = `${prs.length}${prs.length === 1000 ? "+" : ""}`;
	return [fg("dim", `${count} open PR${prs.length === 1 ? "" : "s"}`), ...prs.map(pr => {
		const number = hyperlink(fg("accent", `#${pr.number}`), pr.url);
		const checks = checkSummary(pr.statusCheckRollup).map(part => fg(part.color, part.text)).join(" · ");
		return `${number} (${hyperlink(checks, `${pr.url}/checks`)})`;
	})].join(" · ");
}

export default function (pi: ExtensionAPI) {
	let timer: NodeJS.Timeout | undefined;
	let controller: AbortController | undefined;
	let inFlight: Promise<void> | undefined;
	let stopped = true;

	const refresh = (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" || stopped) return Promise.resolve();
		if (inFlight) return inFlight;
		const signal = controller!.signal;
		inFlight = (async () => {
			const options = { cwd: ctx.cwd, timeout: 15_000, maxBuffer: 10 * 1024 * 1024, signal };
			try {
				await exec("git", ["rev-parse", "--show-toplevel"], options);
			} catch {
				if (!signal.aborted) ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			try {
				// gh resolves the repository from remotes, never from the checked-out branch.
				const { stdout } = await exec("gh", ["pr", "list", "--state", "open", "--author", "@me",
					"--limit", "1000", "--json", "number,url,statusCheckRollup"], options);
				const prs = JSON.parse(stdout) as PullRequest[];
				if (!signal.aborted) ctx.ui.setStatus(STATUS_KEY, renderPrs(prs, (color, text) => ctx.ui.theme.fg(color, text)));
			} catch {
				if (!signal.aborted) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "PRs unavailable · /prs to retry"));
			}
		})().finally(() => { inFlight = undefined; });
		return inFlight;
	};

	pi.registerCommand("prs", {
		description: "Refresh your open PR links and CI checks for this repository",
		handler: async (_args, ctx) => { await refresh(ctx); },
	});
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		stopped = false;
		controller = new AbortController();
		await refresh(ctx);
		if (!stopped) timer = setInterval(() => void refresh(ctx), REFRESH_INTERVAL_MS);
	});
	pi.on("agent_end", (_event, ctx) => { void refresh(ctx); });
	pi.on("session_shutdown", (_event, ctx) => {
		stopped = true;
		controller?.abort();
		if (timer) clearInterval(timer);
		timer = undefined;
		if (ctx.mode === "tui") {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	});
}
