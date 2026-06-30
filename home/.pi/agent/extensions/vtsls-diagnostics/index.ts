import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Diagnostic = {
	severity?: number;
	message: string;
	source?: string;
	code?: string | number;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
};

type DiagnosticState = {
	uri: string;
	path: string;
	diagnostics: Diagnostic[];
	updatedAt: number;
};

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"]);
const ERROR = 1;
const STARTUP_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DIAGNOSTIC_SETTLE_MS = 1_200;
const MAX_REPORTED_DIAGNOSTICS = 30;
const VTSLS_MAX_OLD_SPACE_MB = 12 * 1024;
const EXTENSION_PATH_MARKER = "/vtsls-diagnostics/index.ts";
const PI_EXTENSIONS_PATH_MARKERS = ["/.pi/agent/extensions/", "/.pi/agents/extensions/"];
const REFERENCE_REPO_ROOTS = [resolve(homedir(), ".local/share/pi/references")];

export default function (pi: ExtensionAPI) {
	let client: VtslsClient | undefined;
	let lastContext: ExtensionContext | undefined;
	let lastHealth = "not started";
	let lastCrash: string | undefined;
	const diagnosticState = new Map<string, DiagnosticState>();
	const pendingReports = new Map<string, NodeJS.Timeout>();

	function getClient(ctx: ExtensionContext): VtslsClient {
		lastContext = ctx;
		if (!client || client.disposed) {
			client = new VtslsClient(ctx.cwd, (message) => {
				lastHealth = message;
			}, (uri, diagnostics) => {
				const filePath = fileURLToPathSafe(uri) ?? uri;
				if (isIgnoredDiagnosticPath(filePath)) {
					diagnosticState.delete(uri);
					return;
				}
				diagnosticState.set(uri, {
					uri,
					path: filePath,
					diagnostics,
					updatedAt: Date.now(),
				});
			});
			void client.start().catch((error) => {
				lastCrash = String(error?.message ?? error);
				lastHealth = `unavailable: ${lastCrash}`;
				client = undefined;
			});
		}
		return client;
	}

	function scheduleDiagnostics(ctx: ExtensionContext, filePath: string) {
		if (!isTypeScriptLike(filePath)) return;
		lastContext = ctx;
		const absolutePath = resolve(ctx.cwd, filePath);
		if (isIgnoredDiagnosticPath(absolutePath)) return;
		const uri = pathToFileURL(absolutePath).toString();
		const existing = pendingReports.get(uri);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			pendingReports.delete(uri);
			void refreshAndReport(ctx, absolutePath, uri);
		}, DIAGNOSTIC_SETTLE_MS);
		pendingReports.set(uri, timer);
	}

	async function refreshAndReport(ctx: ExtensionContext, absolutePath: string, uri: string) {
		try {
			await refreshPaths(ctx, [absolutePath]);
			const state = diagnosticState.get(uri);
			const errors = (state?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === ERROR);
			if (errors.length === 0) {
				updateStatus(ctx);
				return;
			}
			const body = formatDiagnostics([{ ...(state as DiagnosticState), diagnostics: errors }]);
			pi.sendMessage(
				{
					customType: "vtsls-diagnostics",
					content: `vtsls reported TypeScript error diagnostics after ${basename(absolutePath)} was read or changed:\n\n${body}`,
					display: true,
					details: { uri, diagnostics: errors },
				},
				{ triggerTurn: true, deliverAs: ctx.isIdle() ? "followUp" : "steer" },
			);
			updateStatus(ctx);
		} catch (error) {
			lastCrash = String((error as Error)?.message ?? error);
			lastHealth = `degraded: ${lastCrash}`;
			updateStatus(ctx);
		}
	}

	function updateStatus(ctx: ExtensionContext) {
		const errorCount = [...diagnosticState.values()].reduce((total, state) => {
			if (isIgnoredDiagnosticPath(state.path)) return total;
			return total + state.diagnostics.filter((d) => d.severity === ERROR).length;
		}, 0);
		const text = errorCount > 0 ? `vtsls: ${errorCount} err` : "vtsls: ok";
		ctx.ui.setStatus?.("vtsls", ctx.ui.theme.fg("dim", text));
	}

	pi.on("session_start", (_event, ctx) => {
		lastContext = ctx;
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		for (const timer of pendingReports.values()) clearTimeout(timer);
		pendingReports.clear();
		await client?.stop();
		client = undefined;
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.isError) return;
		if (event.toolName !== "read" && event.toolName !== "write" && event.toolName !== "edit") return;
		const input = event.input as { path?: unknown };
		if (typeof input.path !== "string") return;
		scheduleDiagnostics(ctx, input.path);
	});

	pi.registerCommand("vtsls-doctor", {
		description: "Check the vtsls diagnostics extension and language-server health",
		handler: async (_args, ctx) => {
			const report = await doctor(ctx);
			ctx.ui.notify(report, report.includes("unavailable") || report.includes("degraded") ? "warning" : "info");
		},
	});

	pi.registerCommand("vtsls-install", {
		description: "Install vtsls globally with npm for the diagnostics extension",
		handler: async (_args, ctx) => {
			const ok = await ctx.ui.confirm(
				"Install vtsls?",
				"Run: npm install -g @vtsls/language-server\n\nThis makes the vtsls binary available to the diagnostics extension.",
			);
			if (!ok) return;
			const result = await pi.exec("npm", ["install", "-g", "@vtsls/language-server"], { timeout: 120_000 });
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
			if (result.code === 0) {
				client = undefined;
				lastCrash = undefined;
				lastHealth = "installed; run /vtsls-doctor to verify";
				ctx.ui.notify(`Installed @vtsls/language-server.\n${output}`.trim(), "info");
			} else {
				lastHealth = `install failed with exit code ${result.code}`;
				ctx.ui.notify(`vtsls install failed.\n${output}`.trim(), "error");
			}
		},
	});

	pi.registerCommand("vtsls-refresh", {
		description: "Refresh vtsls diagnostics; pass paths or --hard to restart vtsls first",
		handler: async (args, ctx) => {
			const { hard, paths } = parseRefreshArgs(args, ctx.cwd);
			const text = await refreshDiagnostics(ctx, paths, hard);
			ctx.ui.notify(text, text.includes("failed") ? "warning" : "info");
		},
	});

	pi.registerCommand("vtsls-diagnostics", {
		description: "Inject current vtsls error diagnostics into the conversation",
		handler: async (_args, ctx) => {
			const text = currentDiagnosticsText();
			pi.sendMessage({ customType: "vtsls-diagnostics", content: text, display: true }, { triggerTurn: true, deliverAs: ctx.isIdle() ? "followUp" : "steer" });
		},
	});

	pi.registerTool({
		name: "vtsls_diagnostics",
		label: "VTSLS Diagnostics",
		description: "Report the current error-level TypeScript diagnostics captured from vtsls.",
		promptSnippet: "Report current vtsls TypeScript error diagnostics",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: currentDiagnosticsText() }], details: { diagnostics: [...diagnosticState.values()] } };
		},
	});

	pi.registerTool({
		name: "vtsls_refresh_diagnostics",
		label: "VTSLS Refresh Diagnostics",
		description: "Refresh vtsls diagnostics by re-reading known TS/JS files, optionally restarting vtsls first.",
		parameters: Type.Object({
			paths: Type.Optional(Type.Array(Type.String({ description: "Specific TS/JS file paths to refresh. Defaults to files already known by vtsls." }))),
			hard: Type.Optional(Type.Boolean({ description: "Restart vtsls and clear cached diagnostics before refreshing." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const paths = params.paths?.map((path) => resolve(ctx.cwd, path));
			const text = await refreshDiagnostics(ctx, paths, Boolean(params.hard));
			return { content: [{ type: "text", text: `${text}\n\n${currentDiagnosticsText()}` }], details: { diagnostics: [...diagnosticState.values()], hard: Boolean(params.hard) } };
		},
	});

	pi.registerTool({
		name: "vtsls_doctor",
		label: "VTSLS Doctor",
		description: "Healthcheck for the vtsls diagnostics extension and language server. If vtsls is missing, reports the npm install command and slash command to run.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			return { content: [{ type: "text", text: await doctor(ctx) }], details: { health: lastHealth, lastCrash } };
		},
	});

	async function doctor(ctx: ExtensionContext): Promise<string> {
		try {
			const lsp = getClient(ctx);
			await lsp.ensureReady();
			return [
				`vtsls diagnostics: healthy`,
				`cwd: ${ctx.cwd}`,
				`server: ${lsp.commandLine}`,
				`memory: --max-old-space-size=${VTSLS_MAX_OLD_SPACE_MB}`,
				`state: ${lastHealth}`,
				lastCrash ? `last issue: ${lastCrash}` : undefined,
			].filter(Boolean).join("\n");
		} catch (error) {
			lastCrash = String((error as Error)?.message ?? error);
			return [
				`vtsls diagnostics: unavailable`,
				`cwd: ${ctx.cwd}`,
				`state: ${lastHealth}`,
				`error: ${lastCrash}`,
				"",
				"Install options:",
				"  /vtsls-install",
				"  npm install -g @vtsls/language-server",
				"",
				"The extension can also use npx --yes @vtsls/language-server --stdio as a fallback, but a global install is faster and more reliable.",
			].join("\n");
		}
	}

	async function refreshDiagnostics(ctx: ExtensionContext, paths?: string[], hard = false): Promise<string> {
		try {
			lastContext = ctx;
			for (const timer of pendingReports.values()) clearTimeout(timer);
			pendingReports.clear();

			const knownPaths = [...diagnosticState.values()].map((state) => state.path);
			if (hard) {
				await client?.stop();
				client = undefined;
				diagnosticState.clear();
				lastHealth = "hard refresh requested; cache cleared";
			}

			const refreshablePaths = (paths?.length ? paths : knownPaths)
				.map((filePath) => resolve(ctx.cwd, filePath))
				.filter((filePath, index, all) => isTypeScriptLike(filePath) && !isIgnoredDiagnosticPath(filePath) && all.indexOf(filePath) === index);

			if (refreshablePaths.length === 0) {
				updateStatus(ctx);
				return hard ? "vtsls diagnostics cache cleared; no known TS/JS files to refresh." : "No known TS/JS files to refresh. Pass paths to /vtsls-refresh or vtsls_refresh_diagnostics.";
			}

			await refreshPaths(ctx, refreshablePaths);
			updateStatus(ctx);
			return `Refreshed vtsls diagnostics for ${refreshablePaths.length} file(s)${hard ? " after restart" : ""}.`;
		} catch (error) {
			lastCrash = String((error as Error)?.message ?? error);
			lastHealth = `refresh failed: ${lastCrash}`;
			updateStatus(ctx);
			return `vtsls diagnostics refresh failed: ${lastCrash}`;
		}
	}

	async function refreshPaths(ctx: ExtensionContext, paths: string[]): Promise<void> {
		const lsp = getClient(ctx);
		await lsp.ensureReady();
		for (const absolutePath of paths) {
			const uri = pathToFileURL(absolutePath).toString();
			diagnosticState.delete(uri);
			await lsp.didOpenOrChange(absolutePath);
		}
		await sleep(DIAGNOSTIC_SETTLE_MS);
	}

	function currentDiagnosticsText(): string {
		const states = [...diagnosticState.values()]
			.filter((state) => !isIgnoredDiagnosticPath(state.path))
			.map((state) => ({ ...state, diagnostics: state.diagnostics.filter((d) => d.severity === ERROR) }))
			.filter((state) => state.diagnostics.length > 0);
		if (states.length === 0) return `No current error-level vtsls diagnostics. Health: ${lastHealth}.`;
		return formatDiagnostics(states);
	}
}

class VtslsClient {
	private child?: ChildProcessWithoutNullStreams;
	private nextId = 1;
	private buffer = Buffer.alloc(0);
	private pending = new Map<number, PendingRequest>();
	private ready?: Promise<void>;
	private openVersions = new Map<string, number>();
	disposed = false;
	commandLine = "";

	constructor(
		private readonly cwd: string,
		private readonly onHealth: (message: string) => void,
		private readonly onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void,
	) {}

	start(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = this.startInner();
		return this.ready;
	}

	ensureReady(): Promise<void> {
		return this.start();
	}

	async didOpenOrChange(filePath: string): Promise<void> {
		if (!existsSync(filePath)) return;
		const text = await readFile(filePath, "utf8");
		const uri = pathToFileURL(filePath).toString();
		const languageId = languageIdFor(filePath);
		const version = (this.openVersions.get(uri) ?? 0) + 1;
		this.openVersions.set(uri, version);
		if (version === 1) {
			this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version, text } });
		} else {
			this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
		}
	}

	async stop(): Promise<void> {
		this.disposed = true;
		try {
			if (this.child && !this.child.killed) {
				this.notify("exit", {});
				this.child.kill();
			}
		} catch {}
	}

	private async startInner(): Promise<void> {
		const candidates: Array<{ command: string; args: string[] }> = [
			{ command: "vtsls", args: ["--stdio"] },
			{ command: "npx", args: ["--yes", "@vtsls/language-server", "--stdio"] },
		];
		let lastError: unknown;
		for (const candidate of candidates) {
			try {
				await this.spawnAndInitialize(candidate.command, candidate.args);
				return;
			} catch (error) {
				lastError = error;
				await this.stop();
				this.disposed = false;
			}
		}
		throw new Error(`Unable to start vtsls: ${String((lastError as Error)?.message ?? lastError)}`);
	}

	private async spawnAndInitialize(command: string, args: string[]): Promise<void> {
		this.commandLine = [command, ...args].join(" ");
		this.onHealth(`starting ${this.commandLine}`);
		this.child = spawn(command, args, {
			cwd: this.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				NODE_OPTIONS: withMaxOldSpaceSize(process.env.NODE_OPTIONS, VTSLS_MAX_OLD_SPACE_MB),
			},
		});
		const startupError = new Promise<never>((_resolve, reject) => {
			this.child?.once("error", (error) => reject(error));
		});
		this.child.stdout.on("data", (chunk) => this.onData(chunk));
		this.child.stderr.on("data", (chunk) => this.onHealth(`stderr: ${String(chunk).trim()}`));
		this.child.on("error", (error) => {
			this.onHealth(`process error: ${error.message}`);
			for (const request of this.pending.values()) {
				clearTimeout(request.timer);
				request.reject(error);
			}
			this.pending.clear();
		});
		this.child.on("exit", (code, signal) => {
			this.onHealth(`exited code=${code ?? "null"} signal=${signal ?? "null"}`);
			for (const request of this.pending.values()) {
				clearTimeout(request.timer);
				request.reject(new Error("vtsls exited"));
			}
			this.pending.clear();
		});
		await Promise.race([this.request("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(this.cwd).toString(),
			capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true, versionSupport: true } } },
			initializationOptions: {},
		}, STARTUP_TIMEOUT_MS), startupError]);
		this.notify("initialized", {});
		this.onHealth("healthy");
	}

	private request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
		const id = this.nextId++;
		this.send({ jsonrpc: "2.0", id, method, params });
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
		});
	}

	private notify(method: string, params: unknown) {
		this.send({ jsonrpc: "2.0", method, params });
	}

	private send(payload: unknown) {
		if (!this.child || this.child.killed) throw new Error("vtsls is not running");
		const body = Buffer.from(JSON.stringify(payload), "utf8");
		this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
		this.child.stdin.write(body);
	}

	private onData(chunk: Buffer) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) return;
			const header = this.buffer.slice(0, headerEnd).toString("utf8");
			const match = /Content-Length: (\d+)/i.exec(header);
			if (!match) {
				this.buffer = this.buffer.slice(headerEnd + 4);
				continue;
			}
			const length = Number(match[1]);
			const start = headerEnd + 4;
			if (this.buffer.length < start + length) return;
			const body = this.buffer.slice(start, start + length).toString("utf8");
			this.buffer = this.buffer.slice(start + length);
			this.handleMessage(JSON.parse(body));
		}
	}

	private handleMessage(message: any) {
		if (typeof message.id === "number" && this.pending.has(message.id)) {
			const request = this.pending.get(message.id)!;
			clearTimeout(request.timer);
			this.pending.delete(message.id);
			if (message.error) request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
			else request.resolve(message.result);
			return;
		}
		if (message.method === "textDocument/publishDiagnostics") {
			this.onDiagnostics(message.params.uri, message.params.diagnostics ?? []);
		}
	}
}

function isTypeScriptLike(filePath: string): boolean {
	return TYPESCRIPT_EXTENSIONS.has(extname(filePath));
}

function languageIdFor(filePath: string): string {
	const ext = extname(filePath);
	if (ext === ".tsx") return "typescriptreact";
	if (ext === ".jsx") return "javascriptreact";
	if (ext === ".js") return "javascript";
	return "typescript";
}

function formatDiagnostics(states: DiagnosticState[]): string {
	let remaining = MAX_REPORTED_DIAGNOSTICS;
	const lines: string[] = [];
	for (const state of states) {
		if (remaining <= 0) break;
		lines.push(`${state.path}:`);
		for (const diagnostic of state.diagnostics.slice(0, remaining)) {
			const line = diagnostic.range.start.line + 1;
			const col = diagnostic.range.start.character + 1;
			const source = diagnostic.source ? ` ${diagnostic.source}` : "";
			const code = diagnostic.code !== undefined ? ` ${diagnostic.code}` : "";
			lines.push(`  ${line}:${col}${source}${code} - ${diagnostic.message.replace(/\s+/g, " ")}`);
			remaining--;
		}
	}
	const total = states.reduce((sum, state) => sum + state.diagnostics.length, 0);
	if (total > MAX_REPORTED_DIAGNOSTICS) lines.push(`…and ${total - MAX_REPORTED_DIAGNOSTICS} more diagnostics.`);
	return lines.join("\n");
}

function fileURLToPathSafe(uri: string): string | undefined {
	try {
		return decodeURIComponent(new URL(uri).pathname);
	} catch {
		return undefined;
	}
}

function isIgnoredDiagnosticPath(filePath: string): boolean {
	const normalizedPath = normalize(filePath).replaceAll("\\", "/");
	return (
		normalizedPath.endsWith(EXTENSION_PATH_MARKER) ||
		PI_EXTENSIONS_PATH_MARKERS.some((marker) => normalizedPath.includes(marker)) ||
		REFERENCE_REPO_ROOTS.some((root) => isPathInside(normalizedPath, root))
	);
}

function isPathInside(normalizedPath: string, root: string): boolean {
	const normalizedRoot = normalize(root).replaceAll("\\", "/");
	return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function parseRefreshArgs(args: string, cwd: string): { hard: boolean; paths: string[] | undefined } {
	const tokens = args.split(/\s+/).filter(Boolean);
	const hard = tokens.includes("--hard") || tokens.includes("-h");
	const paths = tokens
		.filter((token) => token !== "--hard" && token !== "-h")
		.map((path) => resolve(cwd, path));
	return { hard, paths: paths.length > 0 ? paths : undefined };
}

function withMaxOldSpaceSize(existing: string | undefined, megabytes: number): string {
	const withoutOldSpace = (existing ?? "")
		.split(/\s+/)
		.filter((option) => option && !option.startsWith("--max-old-space-size="))
		.join(" ");
	return [withoutOldSpace, `--max-old-space-size=${megabytes}`].filter(Boolean).join(" ");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
