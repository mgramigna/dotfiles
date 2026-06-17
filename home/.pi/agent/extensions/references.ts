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
		.map((ref) => `- @${ref.name}: ${repoPath(ref)}\n  ${ref.description}\n  ${ref.url}`)
		.join("\n");
}

function matchingReferences(prompt: string, references: ReferenceRepo[]) {
	const lower = prompt.toLowerCase();
	return references.filter((ref) => {
		if (lower.includes(`@${ref.name.toLowerCase()}`)) return true;
		const words = `${ref.name} ${ref.description}`
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((word) => word.length >= 4);
		return words.some((word) => lower.includes(word));
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		const config = await loadConfig();
		const references = config.references ?? [];
		if (references.length === 0) return;

		const matches = matchingReferences(event.prompt, references);
		const list = formatReferenceList(matches.length > 0 ? matches : references);
		const extra = `\n\nReference repositories are available for external projects. They are cloned outside this workspace and are safe to inspect with read, ffgrep, fffind, ast-grep, or bash. If the user @mentions a reference (for example @cedarjs) or asks about a topic matching its description, inspect that reference when useful. Do not edit reference repositories unless explicitly asked.\n\nConfigured references:\n${list}`;
		return { systemPrompt: event.systemPrompt + extra };
	});

	pi.registerCommand("references", {
		description: "List, add, or sync reference repositories",
		handler: async (args, ctx) => {
			const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const config = await loadConfig();
			config.references ??= [];

			if (!action || action === "list") {
				ctx.ui.notify(formatReferenceList(config.references), "info");
				return;
			}

			if (action === "sync") {
				const wanted = rest[0];
				const refs = wanted
					? config.references.filter((ref) => ref.name === wanted || `@${ref.name}` === wanted)
					: config.references;
				for (const ref of refs) ctx.ui.notify(await syncReference(ref), "info");
				return;
			}

			if (action === "add") {
				const [name, url, ...descriptionParts] = rest;
				if (!name || !url || descriptionParts.length === 0) {
					ctx.ui.notify("Usage: /references add <name> <git-url> <description>", "warning");
					return;
				}
				config.references = config.references.filter((ref) => ref.name !== name);
				config.references.push({ name, url, description: descriptionParts.join(" ") });
				await saveConfig(config);
				ctx.ui.notify(`Added @${name}. Run /references sync ${name} to clone it.`, "info");
				return;
			}

			ctx.ui.notify("Usage: /references [list|sync [name]|add <name> <git-url> <description>]", "warning");
		},
	});

	pi.registerTool({
		name: "reference_repos",
		label: "Reference Repos",
		description: "List or sync configured external reference repositories",
		promptSnippet: "List or sync external reference repositories configured for this user",
		promptGuidelines: [
			"Use reference_repos to list configured external codebase references when the user @mentions a reference or asks about external framework/source code.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("sync")]),
			name: Type.Optional(Type.String({ description: "Optional reference name for sync" })),
		}),
		async execute(_toolCallId, params) {
			const config = await loadConfig();
			const references = config.references ?? [];
			if (params.action === "list") {
				return { content: [{ type: "text", text: formatReferenceList(references) }] };
			}
			const refs = params.name ? references.filter((ref) => ref.name === params.name) : references;
			const results = [];
			for (const ref of refs) results.push(await syncReference(ref));
			return { content: [{ type: "text", text: results.join("\n") || "No matching references." }] };
		},
	});
}
