import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const FIGMA_API_URL = "https://api.figma.com/v1";
const globalConfigPath = join(homedir(), ".pi", "agent", "figma.json");

interface FigmaErrorResponse {
	err?: string;
	message?: string;
	status?: number;
}

interface FigmaNode {
	id: string;
	name: string;
	type: string;
	children?: FigmaNode[];
	characters?: string;
	style?: Record<string, unknown>;
	styles?: Record<string, string>;
	boundVariables?: Record<string, unknown>;
	fills?: unknown[];
	strokes?: unknown[];
	effects?: unknown[];
	cornerRadius?: number;
	absoluteBoundingBox?: { width?: number; height?: number; x?: number; y?: number };
	layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
	primaryAxisSizingMode?: string;
	counterAxisSizingMode?: string;
	itemSpacing?: number;
	paddingLeft?: number;
	paddingRight?: number;
	paddingTop?: number;
	paddingBottom?: number;
	componentId?: string;
	componentProperties?: Record<string, unknown>;
}

interface FigmaLibraryItem {
	key?: string;
	name?: string;
	description?: string;
	styleType?: string;
}

interface FigmaNodesResponse {
	name?: string;
	lastModified?: string;
	nodes: Record<string, { document?: FigmaNode; components?: Record<string, FigmaLibraryItem>; componentSets?: Record<string, FigmaLibraryItem>; styles?: Record<string, FigmaLibraryItem>; schemaVersion?: number }>;
}

function readJsonApiKey(path: string): string | null {
	if (!existsSync(path)) return null;
	const data = JSON.parse(readFileSync(path, "utf8")) as { apiKey?: string; key?: string; token?: string };
	return data.apiKey || data.key || data.token || null;
}

function writeGlobalApiKey(key: string): void {
	const dir = join(homedir(), ".pi", "agent");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(globalConfigPath, `${JSON.stringify({ apiKey: key }, null, "\t")}\n`, { mode: 0o600 });
}

function apiKey(): string {
	const key =
		process.env.FIGMA_ACCESS_TOKEN ||
		process.env.FIGMA_API_KEY ||
		readJsonApiKey(globalConfigPath) ||
		readJsonApiKey(join(process.cwd(), ".pi", "figma.json"));
	if (!key) {
		throw new Error(
			"Figma access token is not configured. Set FIGMA_ACCESS_TOKEN or create ~/.pi/agent/figma.json with { \"apiKey\": \"figd_...\" }.",
		);
	}
	return key;
}

function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } {
	const trimmed = input.trim();
	try {
		const url = new URL(trimmed);
		const parts = url.pathname.split("/").filter(Boolean);
		const fileMarker = parts.findIndex((part) => ["file", "design", "proto"].includes(part));
		const fileKey = fileMarker >= 0 ? parts[fileMarker + 1] : undefined;
		if (!fileKey) throw new Error("missing file key");
		const rawNodeId = url.searchParams.get("node-id") || url.searchParams.get("node_id") || undefined;
		return { fileKey, nodeId: rawNodeId?.replace(/-/g, ":") };
	} catch {
		if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return { fileKey: trimmed };
		throw new Error("Expected a Figma URL or file key. For node-specific inspection, include ?node-id=... in the URL.");
	}
}

async function figmaGet<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
	const url = new URL(`${FIGMA_API_URL}${path}`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, value);
	}
	const response = await fetch(url, { headers: { "X-Figma-Token": apiKey() } });
	const payload = (await response.json()) as T & FigmaErrorResponse;
	if (!response.ok) throw new Error(payload.err || payload.message || `Figma HTTP ${response.status}`);
	return payload;
}

function summarizeNode(node: FigmaNode, options: { maxDepth: number; maxChildren: number }, depth = 0): string[] {
	const indent = "  ".repeat(depth);
	const box = node.absoluteBoundingBox;
	const parts = [`${indent}- ${node.name} (${node.type}, ${node.id})`];
	if (box?.width || box?.height) parts.push(` ${Math.round(box.width ?? 0)}×${Math.round(box.height ?? 0)}`);
	if (node.layoutMode && node.layoutMode !== "NONE") {
		parts.push(
			` auto-layout=${node.layoutMode.toLowerCase()} gap=${node.itemSpacing ?? 0} padding=${node.paddingTop ?? 0}/${node.paddingRight ?? 0}/${node.paddingBottom ?? 0}/${node.paddingLeft ?? 0}`,
		);
	}
	if (node.cornerRadius !== undefined) parts.push(` radius=${node.cornerRadius}`);
	if (node.characters) parts.push(` text=${JSON.stringify(node.characters)}`);
	const lines = [parts.join("")];
	const children = node.children ?? [];
	if (children.length === 0) return lines;
	if (depth >= options.maxDepth) {
		lines.push(`${indent}  ... ${children.length} child nodes hidden by maxDepth=${options.maxDepth}`);
		return lines;
	}
	for (const child of children.slice(0, options.maxChildren)) lines.push(...summarizeNode(child, options, depth + 1));
	if (children.length > options.maxChildren) lines.push(`${indent}  ... ${children.length - options.maxChildren} more children hidden by maxChildren=${options.maxChildren}`);
	return lines;
}

function countNodes(node: FigmaNode): number {
	return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}

function walkNodes(node: FigmaNode, visit: (node: FigmaNode) => void): void {
	visit(node);
	for (const child of node.children ?? []) walkNodes(child, visit);
}

function topEntries(map: Map<string, number>, limit = 20): string[] {
	return [...map.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit)
		.map(([name, count]) => `- ${name}${count > 1 ? ` ×${count}` : ""}`);
}

function addCount(map: Map<string, number>, key: string | undefined): void {
	if (!key) return;
	map.set(key, (map.get(key) ?? 0) + 1);
}

function styleName(styleId: string, styles?: Record<string, FigmaLibraryItem>): string {
	const style = styles?.[styleId];
	return style?.name ? `${style.name}${style.styleType ? ` (${style.styleType})` : ""}` : `style:${styleId}`;
}

function implementationSummary(node: FigmaNode, metadata: { fileName?: string; components?: Record<string, FigmaLibraryItem>; styles?: Record<string, FigmaLibraryItem> }): string {
	const componentUsage = new Map<string, number>();
	const styleUsage = new Map<string, number>();
	const textStyles = new Map<string, number>();
	const spacing = new Map<string, number>();
	const text: string[] = [];
	const topChildren = (node.children ?? []).map((child) => `${child.name} (${child.type})`).slice(0, 12);

	walkNodes(node, (current) => {
		if (current.type === "INSTANCE") addCount(componentUsage, metadata.components?.[current.componentId ?? ""]?.name ?? current.name);
		for (const [kind, id] of Object.entries(current.styles ?? {})) {
			const label = `${kind}: ${styleName(id, metadata.styles)}`;
			addCount(styleUsage, label);
			if (kind.toLowerCase().includes("text")) addCount(textStyles, styleName(id, metadata.styles));
		}
		if (current.layoutMode && current.layoutMode !== "NONE") {
			if (current.itemSpacing !== undefined) addCount(spacing, `gap fallback ${current.itemSpacing}px`);
			const pads = [current.paddingTop, current.paddingRight, current.paddingBottom, current.paddingLeft];
			if (pads.some((pad) => pad !== undefined)) addCount(spacing, `padding fallback ${pads.map((pad) => pad ?? 0).join("/")}px`);
		}
		if (current.characters?.trim()) text.push(current.characters.trim().replace(/\s+/g, " "));
	});

	const dedupedText = [...new Set(text)].slice(0, 80);
	const box = node.absoluteBoundingBox;
	const lines = [
		`Figma implementation handoff for ${node.name} (${node.type}, ${node.id})${metadata.fileName ? ` in ${metadata.fileName}` : ""}.`,
		box ? `Rendered frame reference size: ${Math.round(box.width ?? 0)}×${Math.round(box.height ?? 0)}. Use this as screenshot context, not as fixed CSS sizing.` : undefined,
		"",
		"Implementation guidance:",
		"- Prefer existing app/design-system primitives that correspond to detected Figma component instances.",
		"- Treat repeated rows/cells as content-driven layout; do not hardcode observed row heights or frame dimensions.",
		"- Use named Figma styles when available. Raw px spacing below is fallback evidence only; map it to the nearest design-system token.",
		"",
		"Top-level structure:",
		...(topChildren.length > 0 ? topChildren.map((child) => `- ${child}`) : ["- No child nodes"]),
		"",
		"Detected component instances:",
		...(topEntries(componentUsage).length > 0 ? topEntries(componentUsage) : ["- None detected"]),
		"",
		"Detected named styles:",
		...(topEntries(styleUsage).length > 0 ? topEntries(styleUsage) : ["- None detected"]),
		"",
		"Typography clues:",
		...(topEntries(textStyles).length > 0 ? topEntries(textStyles) : ["- No named text styles detected; inspect existing app typography tokens/components before using raw font values."]),
		"",
		"Spacing clues:",
		...(topEntries(spacing, 12).length > 0 ? topEntries(spacing, 12) : ["- No auto-layout spacing detected"]),
		"",
		"Visible text samples:",
		...(dedupedText.length > 0 ? dedupedText.map((value) => `- ${value}`) : ["- No text nodes detected"]),
	].filter((line): line is string => line !== undefined);
	return lines.join("\n");
}

async function downloadToFile(url: string, path: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to download Figma image: HTTP ${response.status}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	writeFileSync(path, buffer, { mode: 0o600 });
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "figma_get_node",
		label: "Figma: Get Node",
		description: "Read a Figma file node from a Figma URL or file key plus node id. Defaults to an implementation-oriented handoff summary. Requires ~/.pi/agent/figma.json with an apiKey.",
		parameters: Type.Object({
			url: Type.String({ description: "Figma file/design URL, preferably with ?node-id=..." }),
			nodeId: Type.Optional(Type.String({ description: "Optional Figma node id, e.g. 123:456 or 123-456" })),
			mode: Type.Optional(Type.Union([Type.Literal("implementation"), Type.Literal("tree"), Type.Literal("text")], { description: "Summary mode. implementation is default and is optimized for coding agents.", default: "implementation" })),
			maxDepth: Type.Optional(Type.Number({ description: "Tree mode: maximum child depth to include", default: 3 })),
			maxChildren: Type.Optional(Type.Number({ description: "Tree mode: maximum children per node to include", default: 12 })),
			includeRaw: Type.Optional(Type.Boolean({ description: "Include the raw Figma node JSON in tool details. This can be very large; default false.", default: false })),
		}),
		async execute(_toolCallId, params) {
			const parsed = parseFigmaUrl(params.url);
			const nodeId = (params.nodeId || parsed.nodeId)?.replace(/-/g, ":");
			if (!nodeId) throw new Error("No node id found. Paste a Figma URL that includes ?node-id=... or pass nodeId.");
			const data = await figmaGet<FigmaNodesResponse>(`/files/${parsed.fileKey}/nodes`, { ids: nodeId });
			const entry = data.nodes[nodeId];
			const node = entry?.document;
			if (!node) throw new Error(`Figma node ${nodeId} not found in file ${parsed.fileKey}`);
			const mode = params.mode ?? "implementation";
			const maxDepth = Math.max(0, Math.min(Math.floor(params.maxDepth ?? 3), 10));
			const maxChildren = Math.max(1, Math.min(Math.floor(params.maxChildren ?? 12), 50));
			let summary: string;
			if (mode === "tree") {
				summary = summarizeNode(node, { maxDepth, maxChildren }).join("\n");
			} else if (mode === "text") {
				const text: string[] = [];
				walkNodes(node, (current) => {
					if (current.characters?.trim()) text.push(current.characters.trim().replace(/\s+/g, " "));
				});
				summary = [...new Set(text)].slice(0, 200).map((value) => `- ${value}`).join("\n") || "No text nodes detected.";
			} else {
				summary = implementationSummary(node, { fileName: data.name, components: entry.components, styles: entry.styles });
			}
			return {
				content: [{ type: "text", text: summary }],
				details: {
					fileKey: parsed.fileKey,
					nodeId,
					fileName: data.name,
					lastModified: data.lastModified,
					nodeName: node.name,
					nodeType: node.type,
					mode,
					nodeCount: countNodes(node),
					...(params.includeRaw ? { node } : {}),
				},
			};
		},
	});

	pi.registerTool({
		name: "figma_export_image",
		label: "Figma: Export Image",
		description: "Export a Figma node image, download it to a local temp file for agent inspection, and return the temporary Figma image URL. Requires ~/.pi/agent/figma.json with an apiKey.",
		parameters: Type.Object({
			url: Type.String({ description: "Figma file/design URL, preferably with ?node-id=..." }),
			nodeId: Type.Optional(Type.String({ description: "Optional Figma node id, e.g. 123:456 or 123-456" })),
			format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpg"), Type.Literal("svg"), Type.Literal("pdf")], { default: "png" })),
			scale: Type.Optional(Type.Number({ description: "Export scale for bitmap formats", default: 2 })),
		}),
		async execute(_toolCallId, params) {
			const parsed = parseFigmaUrl(params.url);
			const nodeId = (params.nodeId || parsed.nodeId)?.replace(/-/g, ":");
			if (!nodeId) throw new Error("No node id found. Paste a Figma URL that includes ?node-id=... or pass nodeId.");
			const data = await figmaGet<{ images: Record<string, string | null>; err?: string }>(`/images/${parsed.fileKey}`, {
				ids: nodeId,
				format: params.format || "png",
				scale: String(params.scale ?? 2),
			});
			const imageUrl = data.images[nodeId];
			if (!imageUrl) throw new Error(data.err || `Figma did not return an image for ${nodeId}`);
			const format = params.format || "png";
			const dir = join(tmpdir(), "pi-figma", parsed.fileKey);
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			const localPath = join(dir, `${nodeId.replace(/[^A-Za-z0-9_-]/g, "-")}.${format}`);
			await downloadToFile(imageUrl, localPath);
			return {
				content: [{ type: "text", text: `Saved Figma node image to ${localPath}\nTemporary Figma image URL: ${imageUrl}` }],
				details: { fileKey: parsed.fileKey, nodeId, imageUrl, localPath },
			};
		},
	});

	const checkFigmaSetup = (ctx: any) => {
		try {
			apiKey();
			ctx.ui.notify("Figma extension ready", "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : "Figma extension is not configured", "warning");
		}
	};

	const figmaLogin = async (ctx: any) => {
		const key = (await ctx.ui.input("Figma access token:", "figd_..."))?.trim();
		if (!key) {
			ctx.ui.notify("Figma access token was not saved", "warning");
			return;
		}
		writeGlobalApiKey(key);
		ctx.ui.notify(`Saved Figma access token to ${globalConfigPath}`, "info");
	};

	pi.registerCommand("figma", {
		description: "Figma commands: status, login",
		getArgumentCompletions(prefix) {
			const items = [
				{ value: "status", label: "status", description: "Check Figma extension setup" },
				{ value: "login", label: "login", description: "Save a Figma access token" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const command = args.trim() || "status";
			if (command === "status") return checkFigmaSetup(ctx);
			if (command === "login") return figmaLogin(ctx);
			ctx.ui.notify("Usage: /figma status | /figma login", "warning");
		},
	});
}
