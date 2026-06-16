import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const STATUS_KEY = "gh-pr";
const REFRESH_INTERVAL_MS = 60_000;

type CheckState = "PASS" | "FAIL" | "PENDING" | "SKIP" | "CANCEL" | "";

interface PrView {
	number: number;
	url: string;
}

interface PrCheck {
	name?: string;
	state?: CheckState;
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

function summarizeChecks(checks: PrCheck[] | null): string {
	if (!checks) return "checks ?";

	const total = checks.length;

	if (total === 0) return "checks none";

	const passed = checks.filter((check) => check.state === "PASS" || check.state === "SKIP").length;
	const failed = checks.filter((check) => check.state === "FAIL" || check.state === "CANCEL").length;
	const pending = Math.max(0, total - passed - failed);

	if (failed > 0) return `${passed}/${total} ✓ ${failed} ✗`;
	if (pending > 0) return `${passed}/${total} ✓ ${pending} …`;
	return `${passed}/${total} ✓`;
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
		handler: async (_args, ctx) => {
			await refreshSafely(ctx);
			ctx.ui.notify("GitHub PR status refreshed", "info");
		},
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (timer) clearInterval(timer);
		timer = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
