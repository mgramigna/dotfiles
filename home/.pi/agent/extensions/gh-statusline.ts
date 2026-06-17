import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const STATUS_KEY = "gh-pr";
const REFRESH_INTERVAL_MS = 60_000;

type CheckState =
	| "PASS"
	| "FAIL"
	| "PENDING"
	| "SKIP"
	| "CANCEL"
	| "SUCCESS"
	| "FAILURE"
	| "CANCELLED"
	| "TIMED_OUT"
	| "ACTION_REQUIRED"
	| "NEUTRAL"
	| "SKIPPED"
	| "STARTUP_FAILURE"
	| "STALE"
	| "QUEUED"
	| "IN_PROGRESS"
	| "WAITING"
	| "REQUESTED"
	| "";

interface PrView {
	number: number;
	url: string;
	headRefOid?: string;
}

interface PrCheck {
	name?: string;
	state?: CheckState;
}

interface WorkflowRun {
	databaseId: number;
	name?: string;
	workflowName?: string;
	displayTitle?: string;
	status?: string;
	conclusion?: string;
	url?: string;
}

async function exec(args: string[], cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(args[0]!, args.slice(1), {
			cwd,
			maxBuffer: 1024 * 1024,
			timeout: 15_000,
		});
		return stdout.trim();
	} catch {
		return null;
	}
}

async function getGitRoot(cwd: string): Promise<string | null> {
	return exec(["git", "rev-parse", "--show-toplevel"], cwd);
}

async function ghJson<T>(args: string[], cwd: string): Promise<T | null> {
	const stdout = await exec(["gh", ...args], cwd);
	if (!stdout) return null;

	try {
		return JSON.parse(stdout) as T;
	} catch {
		return null;
	}
}

function osc8(text: string, url: string): string {
	return `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;
}

function formatRun(run: WorkflowRun): string {
	const title = run.workflowName || run.name || run.displayTitle || `run ${run.databaseId}`;
	const suffix = run.conclusion ? ` (${run.conclusion})` : "";
	return `${title}${suffix}`;
}

function isFailedRun(run: WorkflowRun): boolean {
	return ["failure", "cancelled", "timed_out", "action_required"].includes(run.conclusion ?? "");
}

function summarizeChecks(checks: PrCheck[] | null): string {
	if (!checks) return "checks ?";

	const total = checks.length;

	if (total === 0) return "checks none";

	const passedStates = new Set<CheckState>(["PASS", "SKIP", "SUCCESS", "NEUTRAL", "SKIPPED"]);
	const failedStates = new Set<CheckState>([
		"FAIL",
		"CANCEL",
		"FAILURE",
		"CANCELLED",
		"TIMED_OUT",
		"ACTION_REQUIRED",
		"STARTUP_FAILURE",
		"STALE",
	]);

	const passed = checks.filter((check) => passedStates.has(check.state ?? "")).length;
	const failed = checks.filter((check) => failedStates.has(check.state ?? "")).length;
	const pending = Math.max(0, total - passed - failed);

	if (failed > 0) return `${passed}/${total} ✓ ${failed} ✗`;
	if (pending > 0) return `${passed}/${total} ✓ ${pending} …`;
	return `${passed}/${total} ✓`;
}

async function rerunFailedChecks(ctx: ExtensionContext): Promise<void> {
	const gitRoot = await getGitRoot(ctx.cwd);
	if (!gitRoot) {
		ctx.ui.notify("Not in a git repository", "warning");
		return;
	}

	const pr = await ghJson<PrView>(["pr", "view", "--json", "number,headRefOid"], gitRoot);
	if (!pr?.headRefOid) {
		ctx.ui.notify("No current GitHub PR found", "warning");
		return;
	}

	const runs = await ghJson<WorkflowRun[]>(
		[
			"run",
			"list",
			"--commit",
			pr.headRefOid,
			"--json",
			"databaseId,name,workflowName,displayTitle,status,conclusion,url",
		],
		gitRoot,
	);
	const failedRuns = (runs ?? []).filter(isFailedRun);

	if (failedRuns.length === 0) {
		ctx.ui.notify("No failed GitHub Actions runs found for this PR", "success");
		return;
	}

	const choices = [
		`Re-run failed jobs in all ${failedRuns.length} failed runs`,
		...failedRuns.map((run) => `Re-run failed jobs: ${formatRun(run)}`),
		"Cancel",
	];
	const choice = await ctx.ui.select("GitHub Actions rerun", choices);
	if (!choice || choice === "Cancel") return;

	const selectedRuns = choice === choices[0]
		? failedRuns
		: [failedRuns[choices.indexOf(choice) - 1]!];

	let rerunCount = 0;
	const failures: string[] = [];
	for (const run of selectedRuns) {
		const result = await exec(["gh", "run", "rerun", String(run.databaseId), "--failed"], gitRoot);
		if (result === null) {
			failures.push(formatRun(run));
		} else {
			rerunCount += 1;
		}
	}

	if (failures.length > 0) {
		ctx.ui.notify(
			`Re-ran ${rerunCount}; failed to rerun: ${failures.join(", ")}`,
			"warning",
		);
		return;
	}

	ctx.ui.notify(
		`Triggered rerun of failed jobs in ${rerunCount} GitHub Actions run${rerunCount === 1 ? "" : "s"}`,
		"success",
	);
}

async function refresh(ctx: ExtensionContext): Promise<void> {
	const gitRoot = await getGitRoot(ctx.cwd);
	if (!gitRoot) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const theme = ctx.ui.theme;
	const pr = await ghJson<PrView>(["pr", "view", "--json", "number,url"], gitRoot);

	if (!pr) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const checks = await ghJson<PrCheck[]>(
		["pr", "checks", String(pr.number), "--json", "name,state"],
		gitRoot,
	);

	const prText = osc8(`#${pr.number}`, pr.url);
	const checksText = summarizeChecks(checks);
	const color = checksText.includes("✗")
		? "error"
		: checksText.includes("…") || checksText.includes("?")
			? "warning"
			: "success";

	ctx.ui.setStatus(STATUS_KEY, `${theme.fg("accent", "PR ")}${prText} ${theme.fg(color, checksText)}`);
}

export default function (pi: ExtensionAPI) {
	let timer: NodeJS.Timeout | undefined;
	let refreshing = false;

	const refreshSafely = async (ctx: ExtensionContext) => {
		if (refreshing) return;
		refreshing = true;
		try {
			await refresh(ctx);
		} finally {
			refreshing = false;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		await refreshSafely(ctx);
		timer = setInterval(() => void refreshSafely(ctx), REFRESH_INTERVAL_MS);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await refreshSafely(ctx);
	});

	pi.registerCommand("pr-status", {
		description: "Refresh the GitHub PR/checks statusline item",
		handler: async (args, ctx) => {
			if (["rerun", "rerun-failed", "retry"].includes(args.trim())) {
				await rerunFailedChecks(ctx);
				await refreshSafely(ctx);
				return;
			}

			await refreshSafely(ctx);
			ctx.ui.notify("GitHub PR status refreshed", "info");
		},
	});

	pi.registerCommand("pr-rerun-failed", {
		description: "Re-run failed GitHub Actions checks for the current PR",
		handler: async (_args, ctx) => {
			await rerunFailedChecks(ctx);
			await refreshSafely(ctx);
		},
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (timer) clearInterval(timer);
		timer = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
