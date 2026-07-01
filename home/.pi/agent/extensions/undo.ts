import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const MUTATING_TOOLS = new Set(["write", "edit"]);

type FileSnapshot = {
  path: string;
  existed: boolean;
  content?: string;
  bytesBefore: number;
  linesBefore: number;
  bytesAfter?: number;
  linesAfter?: number;
};

type Checkpoint = {
  id: string;
  toolName: string;
  toolCallId: string;
  createdAt: number;
  leafId: string | null;
  targetEntryId: string | null;
  files: FileSnapshot[];
};

const stack: Checkpoint[] = [];
const pending = new Map<string, Checkpoint>();

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function readSnapshot(path: string): FileSnapshot {
  if (!existsSync(path)) {
    return { path, existed: false, bytesBefore: 0, linesBefore: 0 };
  }
  const content = readFileSync(path, "utf8");
  return {
    path,
    existed: true,
    content,
    bytesBefore: Buffer.byteLength(content),
    linesBefore: countLines(content),
  };
}

function refreshAfter(s: FileSnapshot): void {
  if (!existsSync(s.path) || !statSync(s.path).isFile()) {
    s.bytesAfter = 0;
    s.linesAfter = 0;
    return;
  }
  const content = readFileSync(s.path, "utf8");
  s.bytesAfter = Buffer.byteLength(content);
  s.linesAfter = countLines(content);
}

function summarize(cp: Checkpoint): string {
  const files = cp.files.length;
  const lineDelta = cp.files.reduce((n, f) => n + ((f.linesAfter ?? 0) - f.linesBefore), 0);
  const byteDelta = cp.files.reduce((n, f) => n + ((f.bytesAfter ?? 0) - f.bytesBefore), 0);
  const names = cp.files.map((f) => f.path).join(", ");
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
  return `Undid ${cp.toolName}: ${files} file${files === 1 ? "" : "s"}, ${fmt(lineDelta)} lines, ${fmt(byteDelta)} bytes (${names})`;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function toolPaths(toolName: string, input: any, cwd: string): string[] {
  if (!MUTATING_TOOLS.has(toolName)) return [];
  const p = input?.path;
  if (typeof p !== "string" || p.length === 0) return [];
  return [resolve(cwd, p)];
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const paths = unique(toolPaths(event.toolName, event.input, ctx.cwd));
    if (paths.length === 0) return;

    const leafId = ctx.sessionManager.getLeafId();
    const leaf = leafId ? ctx.sessionManager.getEntry(leafId) : undefined;
    const targetEntryId = leaf?.parentId ?? null;
    const checkpoint: Checkpoint = {
      id: `${Date.now()}-${event.toolCallId}`,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      createdAt: Date.now(),
      leafId,
      targetEntryId,
      files: paths.map(readSnapshot),
    };
    pending.set(event.toolCallId, checkpoint);
  });

  pi.on("tool_result", async (event, ctx) => {
    const cp = pending.get(event.toolCallId);
    if (!cp) return;
    pending.delete(event.toolCallId);
    for (const f of cp.files) refreshAfter(f);
    stack.push(cp);
  });

  pi.registerCommand("undo", {
    description: "Restore files and conversation to before the most recent write/edit tool update",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      const cp = stack.pop();
      if (!cp) {
        ctx.ui.notify("Nothing to undo (no write/edit checkpoint recorded in this runtime).", "warning");
        return;
      }

      for (const f of cp.files) {
        if (f.existed) {
          mkdirSync(dirname(f.path), { recursive: true });
          writeFileSync(f.path, f.content ?? "", "utf8");
        } else if (existsSync(f.path)) {
          rmSync(f.path, { recursive: true, force: true });
        }
      }

      const message = summarize(cp);
      ctx.ui.notify(message, "info");
      if (cp.targetEntryId) {
        await ctx.navigateTree(cp.targetEntryId, { summarize: false, label: "undo" });
      }
    },
  });
}
