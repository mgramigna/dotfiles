import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
const projectConfigPath = path.join(process.cwd(), ".pi", "references.json");
const defaultReposDir = path.join(homedir(), ".local", "share", "pi", "references");

function textToolResult(text: string): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details: undefined };
}

const REFERENCES_HELP = `References commands:
- /references list
  List configured reference repositories and local clone paths.
- /references sync [name]
  Clone or update all references, or only one reference. Names may be passed with or without #.
- /references add <name> <git-url> <description>
  Add or replace a user reference in ~/.pi/agent/references.json. Run sync afterward to clone it.
  Example: /references add react https://github.com/facebook/react.git React source code
- /references remove <name>
  Remove a user reference. Names may be passed with or without #.
- /references ensure <package-name-or-url> [description]
  Resolve an npm package's repository (or use a git URL), add it to the user config if needed, and sync it immediately.
  Examples:
    /references ensure vite
    /references ensure https://github.com/mui/base-ui.git Base UI source code
- /references help
  Show this help.

Reference repos are loaded from ~/.pi/agent/references.json and, when present, the shared project config at .pi/references.json. User references override project references with the same name or URL, and add/remove/ensure write only to the user config.

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

function mergeReferences(projectReferences: ReferenceRepo[], userReferences: ReferenceRepo[]) {
	const userNames = new Set(userReferences.map((ref) => ref.name));
	const userUrls = new Set(userReferences.map((ref) => ref.url));
	return [
		...projectReferences.filter((ref) => !userNames.has(ref.name) && !userUrls.has(ref.url)),
		...userReferences,
	];
}

async function loadConfig(): Promise<ReferencesConfig> {
	const [projectConfig, userConfig] = await Promise.all([loadConfigFrom(projectConfigPath), loadUserConfig()]);
	return { references: mergeReferences(projectConfig.references ?? [], userConfig.references ?? []) };
}

async function saveConfig(config: ReferencesConfig) {
	await mkdir(path.dirname(configPath), { recursive: true });
	await writeFile(configPath, `${JSON.stringify(config, null, "\t")}\n`);
}

async function syncReference(ref: ReferenceRepo) {
	const target = repoPath(ref);
	await mkdir(path.dirname(target), { recursive: true });

	if (!(await pathExists(target))) {
		const args = ["clone", "--depth", "1"];
		if (ref.branch) args.push("--branch", ref.branch);
		args.push(ref.url, target);
		await execFileFriendly("git", args, `Couldn't clone reference #${ref.name} from ${ref.url}.`);
		return `cloned ${ref.name} -> ${target}`;
	}

	await execFileFriendly("git", ["-C", target, "fetch", "--depth", "1", "origin"], `Couldn't fetch updates for reference #${ref.name} at ${target}.`);
	const branch = ref.branch ?? "HEAD";
	await execFileAsync("git", ["-C", target, "checkout", branch], { maxBuffer: 1024 * 1024 * 10 }).catch(
		() => undefined,
	);
	await execFileFriendly("git", ["-C", target, "pull", "--ff-only"], `Couldn't update reference #${ref.name} at ${target}.`);
	return `updated ${ref.name} at ${target}`;
}

function formatReferenceList(references: ReferenceRepo[]) {
	if (references.length === 0) {
		return `No reference repositories configured yet.

Get started with one of these commands:
- /references ensure vite
- /references add react https://github.com/facebook/react.git React source code

After adding references, type # in the prompt to autocomplete #mentions. User configuration is stored in ${configPath}; shared project references can be stored in ${projectConfigPath}.`;
	}

	return references
		.map((ref) => `- #${ref.name}: ${repoPath(ref)}\n  ${ref.description}\n  ${ref.url}`)
		.join("\n");
}

function stripMentionPrefix(name: string) {
	return name.replace(/^#/, "");
}

function referenceNameFromPackageName(packageName: string) {
	return slugify(packageName.replace(/^@/, "").replace(/\//g, "-"));
}

function normalizeGitUrl(url: string) {
	return url
		.replace(/^git\+/, "")
		.replace(/^git:/, "https:")
		.replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
		.replace(/^git@github\.com:/, "https://github.com/")
		.replace(/\.git#.*$/, ".git")
		.replace(/#.*$/, "");
}

async function resolveReference(input: string, description?: string): Promise<ReferenceRepo> {
	const normalizedInput = normalizeGitUrl(input);
	if (/^(https?:|ssh:|git@)/.test(input) || normalizedInput.endsWith(".git")) {
		const basename = normalizedInput.split("/").pop()?.replace(/\.git$/, "") ?? input;
		return { name: slugify(basename), url: normalizedInput, description: description ?? `Source reference for ${basename}` };
	}

	const { stdout } = await execFileFriendly(
		"npm",
		["view", input, "name", "description", "repository.url", "homepage", "--json"],
		`Couldn't look up npm package "${input}". Check the package name and your npm/network access.`,
	);
	let metadata: Record<string, any>;
	try {
		metadata = JSON.parse(stdout || "{}");
	} catch (error) {
		throw friendlyError(`npm returned invalid JSON while resolving "${input}".`, error);
	}
	const repositoryUrl = metadata["repository.url"] ?? metadata.repository?.url ?? metadata.homepage;
	if (!repositoryUrl) throw new Error(`Couldn't find a repository URL for npm package "${input}". Try passing a git URL directly.`);
	return {
		name: referenceNameFromPackageName(metadata.name ?? input),
		url: normalizeGitUrl(repositoryUrl),
		description: description ?? metadata.description ?? `Source reference for npm package ${input}`,
	};
}

async function ensureReference(input: string, description?: string) {
	const ref = await resolveReference(input, description);
	const config = await loadUserConfig();
	config.references ??= [];
	const existing = config.references.find((candidate) => candidate.name === ref.name || candidate.url === ref.url);
	const nextRef = existing ? { ...existing, ...ref, description: existing.description || ref.description } : ref;
	config.references = config.references.filter((candidate) => candidate.name !== nextRef.name && candidate.url !== nextRef.url);
	config.references.push(nextRef);
	await saveConfig(config);
	return await syncReference(nextRef);
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

				const config = await loadConfig();
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

	pi.on("before_agent_start", async (event) => {
		const config = await loadConfig();
		const references = config.references ?? [];

		const matches = matchingReferences(event.prompt, references);
		const list = formatReferenceList(matches.length > 0 ? matches : references);
		const extra = `\n\nReference repositories are available for external projects. They are cloned outside this workspace and are safe to inspect with read, ffgrep, fffind, ast-grep, or bash.\n\nReference lookup policy:\n- For questions about external framework/library internals, behavior, APIs, generators, routing, GraphQL, Vite, CLI behavior, or source code, prefer these cloned reference repositories over node_modules.\n- If a configured reference matches the project/topic, inspect the cloned source before looking in node_modules.\n- Before inspecting node_modules for an open-source npm package that is not already configured below, call the reference_repos tool with action=\"ensure\" and name=<npm-package-name>. This resolves the package repository, adds it to references.json, syncs it, and makes future sessions aware of it.\n- Use node_modules only as a fallback when no source repository can be resolved, or when the task specifically depends on installed-package build artifacts or exact installed version.\n- Do not edit reference repositories unless explicitly asked.\n\nConfigured references:\n${list}`;
		return { systemPrompt: event.systemPrompt + extra };
	});

	pi.registerCommand("references", {
		description: "List, add, remove, sync, or show help for reference repositories",
		handler: async (args, ctx) => {
			const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (action === "help" || action === "--help" || action === "-h") {
				ctx.ui.notify(REFERENCES_HELP, "info");
				return;
			}

			let config: ReferencesConfig;
			try {
				config = await loadConfig();
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
				const [rawName, url, ...descriptionParts] = rest;
				const name = rawName ? stripMentionPrefix(rawName) : undefined;
				if (!name || !url || descriptionParts.length === 0) {
					ctx.ui.notify("Usage: /references add <name> <git-url> <description>", "warning");
					return;
				}
				const userConfig = await loadUserConfig();
				userConfig.references ??= [];
				userConfig.references = userConfig.references.filter((ref) => ref.name !== name);
				userConfig.references.push({ name, url, description: descriptionParts.join(" ") });
				await saveConfig(userConfig);
				ctx.ui.notify(`Added #${name} to the user config. Run /references sync ${name} to clone it.`, "info");
				return;
			}

			if (action === "remove") {
				const name = rest[0] ? stripMentionPrefix(rest[0]) : undefined;
				if (!name) {
					ctx.ui.notify("Usage: /references remove <name>", "warning");
					return;
				}
				const userConfig = await loadUserConfig();
				userConfig.references ??= [];
				const nextReferences = userConfig.references.filter((ref) => ref.name !== name);
				if (nextReferences.length === userConfig.references.length) {
					ctx.ui.notify(`No user reference repository named #${name} is configured. Project references in ${projectConfigPath} cannot be removed with this command.`, "warning");
					return;
				}
				userConfig.references = nextReferences;
				await saveConfig(userConfig);
				ctx.ui.notify(`Removed #${name} from the user config.`, "info");
				return;
			}

			if (action === "ensure") {
				const [input, ...descriptionParts] = rest;
				if (!input) {
					ctx.ui.notify("Usage: /references ensure <package-name-or-url> [description]", "warning");
					return;
				}
				try {
					ctx.ui.notify(await ensureReference(input, descriptionParts.join(" ") || undefined), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
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
			action: Type.Union([Type.Literal("list"), Type.Literal("sync"), Type.Literal("ensure")]),
			name: Type.Optional(Type.String({ description: "Reference name for sync, or npm package/git URL for ensure" })),
			description: Type.Optional(Type.String({ description: "Optional description to use when ensuring a new reference" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const config = await loadConfig();
				const references = config.references ?? [];
				if (params.action === "list") {
					return textToolResult(formatReferenceList(references));
				}
				if (params.action === "ensure") {
					if (!params.name) return textToolResult("Missing npm package name or git URL.");
					return textToolResult(await ensureReference(params.name, params.description));
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
