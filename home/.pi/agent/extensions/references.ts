import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
const defaultReposDir = path.join(homedir(), ".local", "share", "pi", "references");

const REFERENCES_HELP = `References commands:
- /references list
  List configured reference repositories and local clone paths.
- /references sync [name]
  Clone or update all references, or only one reference. Names may be passed with or without #.
- /references add <name> <git-url> <description>
  Add or replace a reference in ~/.pi/agent/references.json. Run sync afterward to clone it.
- /references ensure <package-name-or-url> [description]
  Resolve an npm package's repository (or use a git URL), add it if needed, and sync it immediately.
- /references help
  Show this help.

Reference repos are injected into agent context so #mentions and framework/source-code questions can use them. They live outside the current workspace and should be read-only unless explicitly requested.`;

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

async function loadConfig(): Promise<ReferencesConfig> {
	try {
		return JSON.parse(await readFile(configPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { references: [] };
		}
		throw error;
	}
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
		await execFileAsync("git", args, { maxBuffer: 1024 * 1024 * 10 });
		return `cloned ${ref.name} -> ${target}`;
	}

	await execFileAsync("git", ["-C", target, "fetch", "--depth", "1", "origin"], {
		maxBuffer: 1024 * 1024 * 10,
	});
	const branch = ref.branch ?? "HEAD";
	await execFileAsync("git", ["-C", target, "checkout", branch], { maxBuffer: 1024 * 1024 * 10 }).catch(
		() => undefined,
	);
	await execFileAsync("git", ["-C", target, "pull", "--ff-only"], { maxBuffer: 1024 * 1024 * 10 });
	return `updated ${ref.name} at ${target}`;
}

function formatReferenceList(references: ReferenceRepo[]) {
	if (references.length === 0) {
		return `No reference repositories configured yet. Add entries to ${configPath}.`;
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

	const { stdout } = await execFileAsync(
		"npm",
		["view", input, "name", "description", "repository.url", "homepage", "--json"],
		{ maxBuffer: 1024 * 1024 * 2 },
	);
	const metadata = JSON.parse(stdout || "{}");
	const repositoryUrl = metadata["repository.url"] ?? metadata.repository?.url ?? metadata.homepage;
	if (!repositoryUrl) throw new Error(`No repository URL found for npm package ${input}`);
	return {
		name: referenceNameFromPackageName(metadata.name ?? input),
		url: normalizeGitUrl(repositoryUrl),
		description: description ?? metadata.description ?? `Source reference for npm package ${input}`,
	};
}

async function ensureReference(input: string, description?: string) {
	const ref = await resolveReference(input, description);
	const config = await loadConfig();
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
		description: "List, add, sync, or show help for reference repositories",
		handler: async (args, ctx) => {
			const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (action === "help" || action === "--help" || action === "-h") {
				ctx.ui.notify(REFERENCES_HELP, "info");
				return;
			}

			const config = await loadConfig();
			config.references ??= [];

			if (!action || action === "list") {
				ctx.ui.notify(formatReferenceList(config.references), "info");
				return;
			}

			if (action === "sync") {
				const wanted = rest[0] ? stripMentionPrefix(rest[0]) : undefined;
				const refs = wanted ? config.references.filter((ref) => ref.name === wanted) : config.references;
				for (const ref of refs) ctx.ui.notify(await syncReference(ref), "info");
				return;
			}

			if (action === "add") {
				const [rawName, url, ...descriptionParts] = rest;
				const name = rawName ? stripMentionPrefix(rawName) : undefined;
				if (!name || !url || descriptionParts.length === 0) {
					ctx.ui.notify("Usage: /references add <name> <git-url> <description>", "warning");
					return;
				}
				config.references = config.references.filter((ref) => ref.name !== name);
				config.references.push({ name, url, description: descriptionParts.join(" ") });
				await saveConfig(config);
				ctx.ui.notify(`Added #${name}. Run /references sync ${name} to clone it.`, "info");
				return;
			}

			if (action === "ensure") {
				const [input, ...descriptionParts] = rest;
				if (!input) {
					ctx.ui.notify("Usage: /references ensure <package-name-or-url> [description]", "warning");
					return;
				}
				ctx.ui.notify(await ensureReference(input, descriptionParts.join(" ") || undefined), "info");
				return;
			}

			ctx.ui.notify(REFERENCES_HELP, "warning");
		},
	});

	pi.registerTool({
		name: "reference_repos",
		label: "Reference Repos",
		description: "List or sync configured external reference repositories",
		promptSnippet: "List or sync external reference repositories configured for this user",
		promptGuidelines: [
			"Use reference_repos to list configured external codebase references when the user #mentions a reference or asks about external framework/source code.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("sync"), Type.Literal("ensure")]),
			name: Type.Optional(Type.String({ description: "Reference name for sync, or npm package/git URL for ensure" })),
			description: Type.Optional(Type.String({ description: "Optional description to use when ensuring a new reference" })),
		}),
		async execute(_toolCallId, params) {
			const config = await loadConfig();
			const references = config.references ?? [];
			if (params.action === "list") {
				return { content: [{ type: "text", text: formatReferenceList(references) }] };
			}
			if (params.action === "ensure") {
				if (!params.name) return { content: [{ type: "text", text: "Missing npm package name or git URL." }] };
				return { content: [{ type: "text", text: await ensureReference(params.name, params.description) }] };
			}
			const refs = params.name ? references.filter((ref) => ref.name === stripMentionPrefix(params.name)) : references;
			const results = [];
			for (const ref of refs) results.push(await syncReference(ref));
			return { content: [{ type: "text", text: results.join("\n") || "No matching references." }] };
		},
	});
}
