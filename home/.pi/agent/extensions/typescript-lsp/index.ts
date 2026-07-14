import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, normalize, resolve } from "node:path";
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
const DIAGNOSTIC_REQUEST_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_SETTLE_MS = 1_200;
const MAX_REPORTED_DIAGNOSTICS = 30;
const EXTENSION_PATH_MARKER = "/typescript-lsp/index.ts";
const PI_EXTENSIONS_PATH_MARKERS = ["/.pi/agent/extensions/", "/.pi/agents/extensions/"];
const REFERENCE_REPO_ROOTS = [resolve(homedir(), ".local/share/pi/references")];

export default function (pi: ExtensionAPI) {
	const clients = new Map<string, TypeScriptLspClient>();
	let lastHealth = "not started";
	let lastCrash: string | undefined;
	const diagnosticState = new Map<string, DiagnosticState>();
	const pendingReports = new Map<string, NodeJS.Timeout>();

	function getClient(ctx: ExtensionContext, filePath?: string): TypeScriptLspClient {
		const root = discoverProjectRoot(filePath ?? ctx.cwd, ctx.cwd);
		const typescript = findInstalledTypeScript(root);
		if (!typescript || !isTypeScript7OrNewer(typescript.version)) {
			throw new Error(typescript ? `project uses TypeScript ${typescript.version}; native LSP requires TypeScript 7+` : "project does not have a local TypeScript installation");
		}
		let client = clients.get(root);
		if (!client || client.disposed) {
			client = new TypeScriptLspClient(root, (message) => {
				lastHealth = message;
			}, (uri, diagnostics) => {
				const filePath = fileURLToPathSafe(uri) ?? uri;
				if (isIgnoredDiagnosticPath(filePath)) {
					diagnosticState.delete(uri);
					return;
				}
				diagnosticState.set(uri, { uri, path: filePath, diagnostics, updatedAt: Date.now() });
			});
			clients.set(root, client);
			void client.start().catch((error) => {
				lastCrash = String(error?.message ?? error);
				lastHealth = `unavailable: ${lastCrash}`;
				clients.delete(root);
			});
		}
		return client;
	}

	function scheduleDiagnostics(ctx: ExtensionContext, filePath: string) {
		if (!isTypeScriptLike(filePath)) return;
		const absolutePath = resolve(ctx.cwd, filePath);
		if (isIgnoredDiagnosticPath(absolutePath)) return;
		const root = discoverProjectRoot(absolutePath, ctx.cwd);
		if (!isTypeScript7Project(root)) {
			lastHealth = "disabled: current project is not using TypeScript 7+";
			updateStatus(ctx);
			return;
		}
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
					customType: "typescript-lsp-diagnostics",
					content: `TypeScript native LSP reported error diagnostics after ${basename(absolutePath)} was read or changed:\n\n${body}`,
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
		const text = errorCount > 0 ? `ts-lsp: ${errorCount} err` : "ts-lsp: ok";
		ctx.ui.setStatus?.("typescript-lsp", ctx.ui.theme.fg("dim", text));
	}

	pi.on("session_start", (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		for (const timer of pendingReports.values()) clearTimeout(timer);
		pendingReports.clear();
		await Promise.all([...clients.values()].map((client) => client.stop()));
		clients.clear();
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.isError) return;
		if (event.toolName !== "read" && event.toolName !== "write" && event.toolName !== "edit") return;
		const input = event.input as { path?: unknown };
		if (typeof input.path !== "string") return;
		// Fire-and-forget: never await the language server from the tool pipeline.
		scheduleDiagnostics(ctx, input.path);
	});

	const runTypescriptLspDoctor = async (ctx: any) => {
		const report = await doctor(ctx);
		ctx.ui.notify(report, report.includes("unavailable") || report.includes("degraded") ? "warning" : "info");
	};

	const runTypescriptLspRefresh = async (args: string, ctx: any) => {
		const { hard, paths } = parseRefreshArgs(args, ctx.cwd);
		const text = await refreshDiagnostics(ctx, paths, hard);
		ctx.ui.notify(text, text.includes("failed") ? "warning" : "info");
	};

	const sendTypescriptLspDiagnostics = (ctx: any) => {
		pi.sendMessage({ customType: "typescript-lsp-diagnostics", content: currentDiagnosticsText(), display: true }, { triggerTurn: true, deliverAs: ctx.isIdle() ? "followUp" : "steer" });
	};

	pi.registerCommand("typescript-lsp", {
		description: "TypeScript LSP commands: diagnostics, refresh [--hard] [paths...], doctor",
		getArgumentCompletions(prefix) {
			const items = [
				{ value: "diagnostics", label: "diagnostics", description: "Inject current diagnostics into the conversation" },
				{ value: "refresh", label: "refresh", description: "Refresh diagnostics" },
				{ value: "refresh --hard", label: "refresh --hard", description: "Restart LSP and refresh diagnostics" },
				{ value: "doctor", label: "doctor", description: "Check extension and language-server health" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const [command, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (!command || command === "diagnostics") return sendTypescriptLspDiagnostics(ctx);
			if (command === "refresh") return runTypescriptLspRefresh(rest.join(" "), ctx);
			if (command === "doctor") return runTypescriptLspDoctor(ctx);
			ctx.ui.notify("Usage: /typescript-lsp diagnostics | /typescript-lsp refresh [--hard] [paths...] | /typescript-lsp doctor", "warning");
		},
	});


	pi.registerTool({
		name: "typescript_lsp_diagnostics",
		label: "TypeScript LSP Diagnostics",
		description: "Report the current error-level TypeScript diagnostics captured from the native TypeScript 7 LSP.",
		promptSnippet: "Report current TypeScript native LSP error diagnostics",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: currentDiagnosticsText() }], details: { diagnostics: [...diagnosticState.values()] } };
		},
	});

	pi.registerTool({
		name: "typescript_lsp_refresh_diagnostics",
		label: "TypeScript LSP Refresh Diagnostics",
		description: "Refresh native TypeScript LSP diagnostics by re-reading known TS/JS files, optionally restarting first.",
		parameters: Type.Object({
			paths: Type.Optional(Type.Array(Type.String({ description: "Specific TS/JS file paths to refresh. Defaults to files already known by the TypeScript LSP." }))),
			hard: Type.Optional(Type.Boolean({ description: "Restart the TypeScript LSP and clear cached diagnostics before refreshing." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const paths = params.paths?.map((path) => resolve(ctx.cwd, path));
			const text = await refreshDiagnostics(ctx, paths, Boolean(params.hard));
			return { content: [{ type: "text", text: `${text}\n\n${currentDiagnosticsText()}` }], details: { diagnostics: [...diagnosticState.values()], hard: Boolean(params.hard) } };
		},
	});

	pi.registerTool({
		name: "typescript_lsp_doctor",
		label: "TypeScript LSP Doctor",
		description: "Healthcheck for the TypeScript native LSP diagnostics extension and language server.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			return { content: [{ type: "text", text: await doctor(ctx) }], details: { health: lastHealth, lastCrash } };
		},
	});

	async function doctor(ctx: ExtensionContext): Promise<string> {
		try {
			const root = discoverProjectRoot(ctx.cwd, ctx.cwd);
			const typescript = findInstalledTypeScript(root);
			if (!typescript || !isTypeScript7OrNewer(typescript.version)) {
				lastHealth = "disabled: current project is not using TypeScript 7+";
				return [
					"TypeScript native LSP diagnostics: disabled",
					`cwd: ${ctx.cwd}`,
					typescript ? `typescript: ${typescript.version} (${typescript.packageJsonPath})` : "typescript: no local installation found",
					"reason: native LSP requires a local TypeScript 7+ installation",
				].join("\n");
			}
			const lsp = getClient(ctx);
			await lsp.ensureReady();
			return [
				"TypeScript native LSP diagnostics: healthy",
				`cwd: ${ctx.cwd}`,
				`server: ${lsp.commandLine}`,
				`state: ${lastHealth}`,
				lastCrash ? `last issue: ${lastCrash}` : undefined,
			].filter(Boolean).join("\n");
		} catch (error) {
			lastCrash = String((error as Error)?.message ?? error);
			return [
				"TypeScript native LSP diagnostics: unavailable",
				`cwd: ${ctx.cwd}`,
				`state: ${lastHealth}`,
				`error: ${lastCrash}`,
				"",
				"Install TypeScript 7 in the project, or ensure a TypeScript 7 tsc is on PATH:",
				"  npm install -D typescript@7.0.2",
				"",
				"The extension starts the server with: tsc --lsp --stdio. It does not use @typescript/native-preview or tsgo.",
			].join("\n");
		}
	}

	async function refreshDiagnostics(ctx: ExtensionContext, paths?: string[], hard = false): Promise<string> {
		try {
			for (const timer of pendingReports.values()) clearTimeout(timer);
			pendingReports.clear();

			const knownPaths = [...diagnosticState.values()].map((state) => state.path);
			if (hard) {
				await Promise.all([...clients.values()].map((client) => client.stop()));
				clients.clear();
				diagnosticState.clear();
				lastHealth = "hard refresh requested; cache cleared";
			}

			const refreshablePaths = (paths?.length ? paths : knownPaths)
				.map((filePath) => resolve(ctx.cwd, filePath))
				.filter((filePath, index, all) => {
					if (!isTypeScriptLike(filePath) || isIgnoredDiagnosticPath(filePath) || all.indexOf(filePath) !== index) return false;
					return isTypeScript7Project(discoverProjectRoot(filePath, ctx.cwd));
				});

			if (refreshablePaths.length === 0) {
				updateStatus(ctx);
				return hard ? "TypeScript LSP diagnostics cache cleared; no known TS/JS files to refresh." : "No known TS/JS files to refresh. Pass paths to /typescript-lsp-refresh or typescript_lsp_refresh_diagnostics.";
			}

			await refreshPaths(ctx, refreshablePaths);
			updateStatus(ctx);
			return `Refreshed TypeScript LSP diagnostics for ${refreshablePaths.length} file(s)${hard ? " after restart" : ""}.`;
		} catch (error) {
			lastCrash = String((error as Error)?.message ?? error);
			lastHealth = `refresh failed: ${lastCrash}`;
			updateStatus(ctx);
			return `TypeScript LSP diagnostics refresh failed: ${lastCrash}`;
		}
	}

	async function refreshPaths(ctx: ExtensionContext, paths: string[]): Promise<void> {
		for (const absolutePath of paths) {
			const lsp = getClient(ctx, absolutePath);
			await lsp.ensureReady();
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
		if (states.length === 0) return `No current error-level TypeScript native LSP diagnostics. Health: ${lastHealth}.`;
		return formatDiagnostics(states);
	}
}

class TypeScriptLspClient {
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
		await sleep(DIAGNOSTIC_SETTLE_MS);
		await this.pullDiagnostics(uri);
	}

	async pullDiagnostics(uri: string): Promise<void> {
		const response = await this.request(
			"textDocument/diagnostic",
			{ textDocument: { uri } },
			DIAGNOSTIC_REQUEST_TIMEOUT_MS,
		);
		const diagnostics = diagnosticsFromDocumentDiagnosticResponse(response);
		if (diagnostics) this.onDiagnostics(uri, diagnostics);
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
		const candidates = buildTscCandidates(this.cwd);
		let lastError: unknown;
		for (const candidate of candidates) {
			try {
				await this.spawnAndInitialize(candidate.command, candidate.args, candidate.cwd);
				return;
			} catch (error) {
				lastError = error;
				await this.stop();
				this.disposed = false;
			}
		}
		throw new Error(`Unable to start TypeScript native LSP from ${this.cwd}: ${String((lastError as Error)?.message ?? lastError)}`);
	}

	private async spawnAndInitialize(command: string, args: string[], cwd: string): Promise<void> {
		this.commandLine = `(cd ${cwd} && ${[command, ...args].join(" ")})`;
		this.onHealth(`starting ${this.commandLine}`);
		this.child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env });
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
				request.reject(new Error("TypeScript LSP exited"));
			}
			this.pending.clear();
		});
		await Promise.race([this.request("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(this.cwd).toString(),
			capabilities: {
				textDocument: {
					publishDiagnostics: { relatedInformation: true, versionSupport: true },
					diagnostic: { relatedDocumentSupport: true },
				},
			},
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
		if (!this.child || this.child.killed) throw new Error("TypeScript LSP is not running");
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
			return;
		}
		if (message.id !== undefined && typeof message.method === "string") {
			this.handleServerRequest(message);
		}
	}

	private handleServerRequest(message: { id: string | number | null; method: string; params?: unknown }) {
		let result: unknown = null;
		switch (message.method) {
			case "workspace/configuration":
				result = configurationResponse(message.params);
				break;
			case "client/registerCapability":
			case "client/unregisterCapability":
			case "window/workDoneProgress/create":
			case "workspace/diagnostic/refresh":
			case "workspace/inlayHint/refresh":
			case "workspace/codeLens/refresh":
				result = null;
				break;
			default:
				this.onHealth(`unhandled server request: ${message.method}`);
				result = null;
		}
		this.send({ jsonrpc: "2.0", id: message.id, result });
	}
}

type TscCandidate = { command: string; args: string[]; cwd: string };
type TypeScriptInstallation = { root: string; version: string; packageJsonPath: string };

function discoverProjectRoot(filePath: string, fallbackCwd: string): string {
	const absolutePath = resolve(fallbackCwd, filePath);
	let dir = isDirectoryPath(absolutePath) ? absolutePath : dirname(absolutePath);
	let firstPackage: string | undefined;
	let firstWorkspace: string | undefined;
	for (const current of ancestors(dir)) {
		if (isRepoPackageRoot(current)) {
			const typescript = findLocalInstalledTypeScript(current);
			if (typescript && isTypeScript7OrNewer(typescript.version)) return current;
			firstPackage ??= current;
		}
		if (existsSync(resolve(current, "tsconfig.json"))) return current;
		if (!firstWorkspace && hasPackageManagerMarker(current)) firstWorkspace = current;
	}
	return firstPackage ?? firstWorkspace ?? fallbackCwd;
}

function isTypeScript7Project(root: string): boolean {
	const typescript = findInstalledTypeScript(root);
	return Boolean(typescript && isTypeScript7OrNewer(typescript.version));
}

function findInstalledTypeScript(root: string): TypeScriptInstallation | undefined {
	for (const current of ancestors(root)) {
		if (!isRepoPackageRoot(current)) continue;
		const typescript = findLocalInstalledTypeScript(current);
		if (typescript) return typescript;
	}
	return undefined;
}

function findLocalInstalledTypeScript(root: string): TypeScriptInstallation | undefined {
	const packageJsonPath = resolve(root, "node_modules/typescript/package.json");
	if (!existsSync(packageJsonPath)) return undefined;
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
		if (typeof packageJson.version === "string") return { root, version: packageJson.version, packageJsonPath };
	} catch {}
	return undefined;
}

function isRepoPackageRoot(dir: string): boolean {
	return !isNodeModulesPath(dir) && existsSync(resolve(dir, "package.json"));
}

function isNodeModulesPath(filePath: string): boolean {
	return normalize(filePath).replaceAll("\\", "/").split("/").includes("node_modules");
}

function isTypeScript7OrNewer(version: string): boolean {
	const major = Number(/^(\d+)/.exec(version)?.[1]);
	return Number.isFinite(major) && major >= 7;
}

function buildTscCandidates(root: string): TscCandidate[] {
	const candidates: TscCandidate[] = [];
	const seen = new Set<string>();
	const add = (candidate: TscCandidate) => {
		const key = `${candidate.cwd}\0${candidate.command}\0${candidate.args.join("\0")}`;
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push(candidate);
	};

	for (const current of ancestors(root)) {
		const typescript = findInstalledTypeScript(current);
		if (!typescript || !isTypeScript7OrNewer(typescript.version)) continue;
		const localTsc = resolve(typescript.root, "node_modules/.bin/tsc");
		if (existsSync(localTsc)) add({ command: localTsc, args: ["--lsp", "--stdio"], cwd: typescript.root });
	}

	return candidates;
}

function detectPackageManager(root: string): "yarn" | "pnpm" | "npm" | undefined {
	for (const current of ancestors(root)) {
		if (existsSync(resolve(current, "yarn.lock"))) return "yarn";
		if (existsSync(resolve(current, "pnpm-lock.yaml"))) return "pnpm";
		if (existsSync(resolve(current, "package-lock.json"))) return "npm";
	}
	return undefined;
}

function hasPackageManagerMarker(dir: string): boolean {
	return existsSync(resolve(dir, "yarn.lock")) || existsSync(resolve(dir, "pnpm-lock.yaml")) || existsSync(resolve(dir, "package-lock.json"));
}

function ancestors(start: string): string[] {
	const result: string[] = [];
	let current = resolve(start);
	while (true) {
		result.push(current);
		const parent = dirname(current);
		if (parent === current) return result;
		current = parent;
	}
}

function isDirectoryPath(filePath: string): boolean {
	try {
		return statSync(filePath).isDirectory();
	} catch {
		return false;
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

function configurationResponse(params: unknown): unknown[] {
	const items = params && typeof params === "object" && Array.isArray((params as { items?: unknown }).items)
		? (params as { items: unknown[] }).items
		: [];
	return items.map(() => ({}));
}

function diagnosticsFromDocumentDiagnosticResponse(response: unknown): Diagnostic[] | undefined {
	if (!response || typeof response !== "object") return undefined;
	const report = response as { kind?: string; items?: unknown; relatedDocuments?: Record<string, unknown> };
	if (report.kind === "unchanged") return undefined;
	const diagnostics = Array.isArray(report.items) ? report.items.filter(isDiagnostic) : [];
	if (report.relatedDocuments) {
		for (const related of Object.values(report.relatedDocuments)) {
			const relatedDiagnostics = diagnosticsFromDocumentDiagnosticResponse(related);
			if (relatedDiagnostics) diagnostics.push(...relatedDiagnostics);
		}
	}
	return diagnostics;
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return Boolean(
		value &&
			typeof value === "object" &&
			"message" in value &&
			"range" in value,
	);
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
