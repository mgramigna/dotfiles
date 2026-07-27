import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { CONFIG_DIR_NAME, type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

interface ReferenceRepo {
	name: string;
	url: string;
	description: string;
	branch?: string;
	path?: string;
}

interface ReferencesConfig {
	references?: ReferenceRepo[];
}

const configPath = path.join(homedir(), ".pi", "agent", "references.json");
function projectConfigPathFor(cwd = process.cwd()) {
	return path.join(cwd, CONFIG_DIR_NAME, "references.json");
}
const defaultReposDir = path.join(homedir(), ".local", "share", "pi", "references");

function textToolResult(text: string): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details: undefined };
}

const REFERENCES_HELP = `References commands:
- /references list
  List configured reference repositories and local clone paths.
- /references sync [name]
  Clone or update all references, or only one reference. Names may be passed with or without #.
- /references add [--global|--project] [--ref branch|tag|commit] [name] [git-url] [description]
  Add or replace a reference. With missing args, Pi prompts for them interactively.
  Defaults to --global (~/.pi/agent/references.json). Use --project to write check-in-able .pi/references.json.
  The optional --ref value pins the repository to a branch, tag, or commit.
  Example: /references add --project --ref v19.0.0 react https://github.com/facebook/react.git React source code
- /references remove <name>
  Remove a user reference. Names may be passed with or without #.
- /references help
  Show this help.

Reference repos are loaded from ~/.pi/agent/references.json and, when present, the shared project config at .pi/references.json. Global references override project references with the same name or URL. add/remove can target either scope.

Reference repos are injected into agent context so #mentions and framework/source-code questions can use them. Type # in the prompt to autocomplete configured references, such as #react or #vite. They live outside the current workspace and should be read-only unless explicitly requested.`;

function slugify(name: string) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function repoPath(ref: ReferenceRepo) {
	return ref.path ? path.resolve(ref.path.replace(/^~/, homedir())) : path.join(defaultReposDir, slugify(ref.name));
}

async function pathExists(p: string) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

function briefTechnicalDetail(error: unknown) {
	if (!(error instanceof Error)) return String(error);
	const maybeExec = error as Error & { code?: unknown; stderr?: string; stdout?: string };
	const detail = maybeExec.stderr?.trim() || maybeExec.stdout?.trim() || error.message;
	const code = maybeExec.code ? ` (exit ${maybeExec.code})` : "";
	return `${detail}${code}`.split("\n").slice(0, 4).join("\n");
}

function friendlyError(message: string, error: unknown) {
	return new Error(`${message}\n\nDetails: ${briefTechnicalDetail(error)}`);
}

async function execFileFriendly(command: string, args: string[], userMessage: string) {
	try {
		return await execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 10 });
	} catch (error) {
		throw friendlyError(userMessage, error);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReferenceRepo(value: unknown): value is ReferenceRepo {
	return isRecord(value)
		&& typeof value.name === "string"
		&& typeof value.url === "string"
		&& typeof value.description === "string"
		&& (value.branch === undefined || typeof value.branch === "string")
		&& (value.path === undefined || typeof value.path === "string");
}

function parseConfig(contents: string): ReferencesConfig {
	const parsed: unknown = JSON.parse(contents);
	if (!isRecord(parsed)) throw new Error("Expected a JSON object.");
	const references = parsed.references;
	if (references === undefined) return { references: [] };
	if (!Array.isArray(references) || !references.every(isReferenceRepo)) {
		throw new Error("Expected references to be an array of { name, url, description, branch?, path? } objects.");
	}
	return { references };
}

async function loadConfigFrom(filePath: string): Promise<ReferencesConfig> {
	try {
		return parseConfig(await readFile(filePath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { references: [] };
		}
		throw friendlyError(`Couldn't read reference repository configuration at ${filePath}. Check that it is valid JSON.`, error);
	}
}

async function loadUserConfig(): Promise<ReferencesConfig> {
	return loadConfigFrom(configPath);
}

async function loadProjectConfig(cwd?: string): Promise<ReferencesConfig> {
	return loadConfigFrom(projectConfigPathFor(cwd));
}

function mergeReferences(projectReferences: ReferenceRepo[], userReferences: ReferenceRepo[]) {
	const userNames = new Set(userReferences.map((ref) => ref.name));
	const userUrls = new Set(userReferences.map((ref) => ref.url));
	return [
		...projectReferences.filter((ref) => !userNames.has(ref.name) && !userUrls.has(ref.url)),
		...userReferences,
	];
}

async function loadConfig(cwd?: string): Promise<ReferencesConfig> {
	const [projectConfig, userConfig] = await Promise.all([loadProjectConfig(cwd), loadUserConfig()]);
	return { references: mergeReferences(projectConfig.references ?? [], userConfig.references ?? []) };
}

async function saveConfig(config: ReferencesConfig, filePath = configPath) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(config, null, "\t")}\n`);
}

async function syncReference(ref: ReferenceRepo) {
	const target = repoPath(ref);
	await mkdir(path.dirname(target), { recursive: true });
	const existed = await pathExists(target);
	let checkoutRef = "FETCH_HEAD";

	if (!existed) {
		const args = ["clone", "--depth", "1"];
		if (ref.branch) args.push("--branch", ref.branch);
		args.push(ref.url, target);
		try {
			await execFileFriendly("git", args, `Couldn't clone reference #${ref.name} from ${ref.url}.`);
		} catch (error) {
			// `git clone --branch` accepts branches and tags, but not commit SHAs.
			// Fall back to a regular clone so commit-pinned references can be checked out locally.
			if (!ref.branch) throw error;
			await execFileFriendly("git", ["clone", ref.url, target], `Couldn't clone reference #${ref.name} from ${ref.url}.`);
			checkoutRef = ref.branch;
		}
	}

	if (checkoutRef === "FETCH_HEAD") {
		const fetchRef = ref.branch ?? "HEAD";
		await execFileFriendly("git", ["-C", target, "fetch", "--depth", "1", "origin", fetchRef], `Couldn't fetch updates for reference #${ref.name} at ${target}.`);
	}

	// Reference repositories are read-only caches. Update them by resetting to the
	// fetched commit instead of pulling, so locally divergent or detached shallow
	// clones do not fail with "Not possible to fast-forward". Use detached HEAD for
	// pinned refs because the value may be a branch, tag, or commit.
	await execFileFriendly("git", ["-C", target, "checkout", "--force", "--detach", checkoutRef], `Couldn't check out updates for reference #${ref.name} at ${target}.`);
	await execFileFriendly("git", ["-C", target, "reset", "--hard", checkoutRef], `Couldn't reset reference #${ref.name} at ${target}.`);
	return `${existed ? "updated" : "cloned"} ${ref.name} at ${target}`;
}

function formatReferenceList(references: ReferenceRepo[]) {
	if (references.length === 0) {
		return `No reference repositories configured yet.

Get started with one of these commands:
- /references add
- /references add react https://github.com/facebook/react.git React source code

After adding references, type # in the prompt to autocomplete #mentions. Global configuration is stored in ${configPath}; shared project references can be stored in ${projectConfigPathFor()}.`;
	}

	return references
		.map((ref) => {
			const pinned = ref.branch ? `\n  pinned ref: ${ref.branch}` : "";
			return `- #${ref.name}: ${repoPath(ref)}\n  ${ref.description}\n  ${ref.url}${pinned}`;
		})
		.join("\n");
}

function stripMentionPrefix(name: string) {
	return name.replace(/^#/, "");
}

type ReferenceScope = "global" | "project";

function consumeScopeFlag(args: string[]): { scope: ReferenceScope; rest: string[] } {
	const rest = [...args];
	let scope: ReferenceScope = "global";
	const index = rest.findIndex((arg) => arg === "--global" || arg === "--user" || arg === "--project");
	if (index >= 0) {
		scope = rest[index] === "--project" ? "project" : "global";
		rest.splice(index, 1);
	}
	return { scope, rest };
}

function consumeRefFlag(args: string[]): { branch?: string; rest: string[] } {
	const rest = [...args];
	const index = rest.findIndex((arg) => arg === "--ref" || arg === "--branch" || arg === "--tag" || arg === "--commit");
	if (index < 0) return { rest };
	const branch = rest[index + 1];
	rest.splice(index, branch ? 2 : 1);
	return { branch, rest };
}

function configPathForScope(scope: ReferenceScope, cwd?: string) {
	return scope === "project" ? projectConfigPathFor(cwd) : configPath;
}

async function loadConfigForScope(scope: ReferenceScope, cwd?: string) {
	return scope === "project" ? loadProjectConfig(cwd) : loadUserConfig();
}

function matchingReferences(prompt: string, references: ReferenceRepo[]) {
	const lower = prompt.toLowerCase();
	return references.filter((ref) => {
		const name = ref.name.toLowerCase();
		if (lower.includes(`#${name}`)) return true;
		const words = `${ref.name} ${ref.description}`
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((word) => word.length >= 4);
		return words.some((word) => lower.includes(word));
	});
}

function currentMentionPrefix(lines: string[], cursorLine: number, cursorCol: number) {
	const beforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
	return beforeCursor.match(/(^|\s)(#[a-zA-Z0-9._-]*)$/)?.[2] ?? null;
}

export default function (pi: ExtensionAPI) {
	let autocompleteRegistered = false;

	pi.on("session_start", async (_event, ctx) => {
		if (autocompleteRegistered) return;
		autocompleteRegistered = true;
		ctx.ui.addAutocompleteProvider((current) => ({
			triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "#"])],
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const prefix = currentMentionPrefix(lines, cursorLine, cursorCol);
				if (!prefix) return current.getSuggestions(lines, cursorLine, cursorCol, options);

				const config = await loadConfig(ctx.cwd);
				const marker = prefix[0];
				const query = prefix.slice(1).toLowerCase();
				const items = (config.references ?? [])
					.filter((ref) => ref.name.toLowerCase().includes(query))
					.map((ref) => ({
						value: `${marker}${ref.name}`,
						label: `${marker}${ref.name}`,
						description: ref.description,
					}));
				return items.length > 0 ? { items, prefix } : current.getSuggestions(lines, cursorLine, cursorCol, options);
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				if (!prefix.startsWith("#") || !item.value.startsWith("#")) {
					return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
				}
				const line = lines[cursorLine] ?? "";
				const start = Math.max(0, cursorCol - prefix.length);
				const nextLines = [...lines];
				nextLines[cursorLine] = `${line.slice(0, start)}${item.value}${line.slice(cursorCol)}`;
				return { lines: nextLines, cursorLine, cursorCol: start + item.value.length };
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
			},
		}));
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const config = await loadConfig(ctx.cwd);
		const references = config.references ?? [];

		const matches = matchingReferences(event.prompt, references);
		const list = formatReferenceList(matches.length > 0 ? matches : references);
		const extra = `\n\nReference repositories are available for external projects. They are cloned outside this workspace and are safe to inspect with read, ffgrep, fffind, ast-grep, or bash.\n\nReference lookup policy:\n- For questions about external framework/library internals, behavior, APIs, generators, routing, GraphQL, Vite, CLI behavior, or source code, prefer these cloned reference repositories over node_modules.\n- If a configured reference matches the project/topic, inspect the cloned source before looking in node_modules.\n- Use node_modules only as a fallback when no source repository can be resolved, or when the task specifically depends on installed-package build artifacts or exact installed version.\n- Do not edit reference repositories unless explicitly asked.\n\nConfigured references:\n${list}`;
		return { systemPrompt: event.systemPrompt + extra };
	});

	pi.registerCommand("references", {
		description: "List, add, remove, sync, or show help for reference repositories",
		getArgumentCompletions(prefix) {
			const items = [
				{ value: "list", label: "list", description: "List configured references" },
				{ value: "sync", label: "sync", description: "Sync all or one reference repository" },
				{ value: "add ", label: "add", description: "Add a reference interactively, or: add [--project] [--ref <branch|tag|commit>] <name> <git-url> <description>" },
				{ value: "remove ", label: "remove", description: "Remove a global/project reference" },
				{ value: "help", label: "help", description: "Show help" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (action === "help" || action === "--help" || action === "-h") {
				ctx.ui.notify(REFERENCES_HELP, "info");
				return;
			}

			let config: ReferencesConfig;
			try {
				config = await loadConfig(ctx.cwd);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			config.references ??= [];

			if (!action || action === "list") {
				ctx.ui.notify(formatReferenceList(config.references), "info");
				return;
			}

			if (action === "sync") {
				const wanted = rest[0] ? stripMentionPrefix(rest[0]) : undefined;
				const refs = wanted ? config.references.filter((ref) => ref.name === wanted) : config.references;
				if (wanted && refs.length === 0) {
					ctx.ui.notify(`No reference repository named #${wanted} is configured. Run /references list to see available references.`, "warning");
					return;
				}
				try {
					for (const ref of refs) ctx.ui.notify(await syncReference(ref), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}

			if (action === "add") {
				const scoped = consumeScopeFlag(rest);
				const pinned = consumeRefFlag(scoped.rest);
				let { scope } = scoped;
				let { branch } = pinned;
				let [rawName, url, ...descriptionParts] = pinned.rest;
				if (pinned.rest.length === 0 && ctx.hasUI) {
					scope = ((await ctx.ui.select("Where should this reference be saved?", ["global", "project"])) ?? scope) as ReferenceScope;
					rawName = await ctx.ui.input("Reference name (used as #name):", "react") ?? "";
					url = await ctx.ui.input("Git repository URL:", "https://github.com/facebook/react.git") ?? "";
					branch = (await ctx.ui.input("Optional branch, tag, or commit to pin (leave blank for default HEAD):", "") ?? "").trim() || undefined;
					descriptionParts = [(await ctx.ui.input("Short description:", "React source code") ?? "").trim()];
				}
				const name = rawName ? stripMentionPrefix(rawName) : undefined;
				const description = descriptionParts.join(" ").trim();
				if (!name || !url || !description) {
					ctx.ui.notify("Usage: /references add [--global|--project] [--ref <branch|tag|commit>] <name> <git-url> <description> (or run /references add for prompts)", "warning");
					return;
				}
				const targetPath = configPathForScope(scope, ctx.cwd);
				const targetConfig = await loadConfigForScope(scope, ctx.cwd);
				targetConfig.references ??= [];
				targetConfig.references = targetConfig.references.filter((ref) => ref.name !== name && ref.url !== url);
				targetConfig.references.push({ name, url, description, ...(branch ? { branch } : {}) });
				await saveConfig(targetConfig, targetPath);
				ctx.ui.notify(`Added #${name} to the ${scope} config (${targetPath}). Run /references sync ${name} to clone it.`, "info");
				return;
			}

			if (action === "remove") {
				const scoped = consumeScopeFlag(rest);
				const name = scoped.rest[0] ? stripMentionPrefix(scoped.rest[0]) : undefined;
				if (!name) {
					ctx.ui.notify("Usage: /references remove [--global|--project] <name>", "warning");
					return;
				}
				const targetPath = configPathForScope(scoped.scope, ctx.cwd);
				const targetConfig = await loadConfigForScope(scoped.scope, ctx.cwd);
				targetConfig.references ??= [];
				const nextReferences = targetConfig.references.filter((ref) => ref.name !== name);
				if (nextReferences.length === targetConfig.references.length) {
					ctx.ui.notify(`No ${scoped.scope} reference repository named #${name} is configured in ${targetPath}.`, "warning");
					return;
				}
				targetConfig.references = nextReferences;
				await saveConfig(targetConfig, targetPath);
				ctx.ui.notify(`Removed #${name} from the ${scoped.scope} config.`, "info");
				return;
			}

			ctx.ui.notify(REFERENCES_HELP, "warning");
		},
	});

	pi.registerTool({
		name: "reference_repos",
		label: "Reference Repos",
		description: "List or sync configured external reference repositories",
		promptSnippet: "List or sync external reference repositories configured for this user and project",
		promptGuidelines: [
			"Use reference_repos to list configured external codebase references when the user #mentions a reference or asks about external framework/source code.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("sync")]),
			name: Type.Optional(Type.String({ description: "Optional reference name for sync" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const config = await loadConfig();
				const references = config.references ?? [];
				if (params.action === "list") {
					return textToolResult(formatReferenceList(references));
				}
				const name = params.name;
				const wanted = name ? stripMentionPrefix(name) : undefined;
				const refs = wanted ? references.filter((ref) => ref.name === wanted) : references;
				if (wanted && refs.length === 0) {
					return textToolResult(`Warning: no reference repository named #${wanted} is configured. Use action="list" to see available references.`);
				}
				const results = [];
				for (const ref of refs) results.push(await syncReference(ref));
				return textToolResult(results.join("\n") || "No matching references.");
			} catch (error) {
				return textToolResult(error instanceof Error ? error.message : String(error));
			}
		},
	});
}
