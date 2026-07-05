import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { OrchestratorRunState, WorkerResult } from "./state";

export type WorkerFiles = {
  dir: string;
  promptPath: string;
  resultPath: string;
  stdoutPath: string;
  stderrPath: string;
  worktrunkLogPath: string;
};

export function getOrchestratorDir(cwd: string): string {
  return join(cwd, ".orchestrator");
}

export function getRunDir(cwd: string, runId: string): string {
  return join(getOrchestratorDir(cwd), "runs", safePathPart(runId));
}

export function getStatePath(cwd: string, runId: string): string {
  return join(getRunDir(cwd, runId), "state.json");
}

export function getEventsPath(cwd: string, runId: string): string {
  return join(getRunDir(cwd, runId), "events.jsonl");
}

export function getWorkerFiles(cwd: string, runId: string, issueNumber: number): WorkerFiles {
  const dir = join(getRunDir(cwd, runId), "workers", `issue-${issueNumber}`);

  return {
    dir,
    promptPath: join(dir, "prompt.md"),
    resultPath: join(dir, "done.json"),
    stdoutPath: join(dir, "stdout.log"),
    stderrPath: join(dir, "stderr.log"),
    worktrunkLogPath: join(dir, "worktrunk.log"),
  };
}

export async function ensureRunLayout(cwd: string, runId: string): Promise<void> {
  await mkdir(join(getRunDir(cwd, runId), "workers"), { recursive: true });
}

export async function loadRunState(cwd: string, runId: string): Promise<OrchestratorRunState> {
  const raw = await readFile(getStatePath(cwd, runId), "utf8");
  const parsed = JSON.parse(raw) as unknown;

  assertRunState(parsed);

  return parsed;
}

export async function saveRunState(cwd: string, state: OrchestratorRunState): Promise<void> {
  const path = getStatePath(cwd, state.runId);
  const tmpPath = `${path}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export async function appendRunEvent(
  cwd: string,
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  const path = getEventsPath(cwd, runId);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

export async function writeWorkerPrompt(input: {
  cwd: string;
  runId: string;
  issueNumber: number;
  prompt: string;
}): Promise<WorkerFiles> {
  const files = getWorkerFiles(input.cwd, input.runId, input.issueNumber);

  await mkdir(files.dir, { recursive: true });
  await writeFile(files.promptPath, input.prompt, "utf8");

  return files;
}

export async function readWorkerResult(path: string): Promise<WorkerResult> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  assertWorkerResult(parsed);

  return parsed;
}

function safePathPart(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Unsafe path part: ${value}`);
  }

  return value;
}

function assertRunState(value: unknown): asserts value is OrchestratorRunState {
  if (!isRecord(value)) throw new Error("Run state must be an object");
  if (value.schemaVersion !== 1) throw new Error("Unsupported run state schemaVersion");
  if (typeof value.runId !== "string") throw new Error("Run state missing runId");
  if (!isRecord(value.parent)) throw new Error("Run state missing parent");
  if (!isRecord(value.plan)) throw new Error("Run state missing plan");
  if (!isRecord(value.worktrunk)) throw new Error("Run state missing worktrunk");
  if (!isRecord(value.slices)) throw new Error("Run state missing slices");
}

function assertWorkerResult(value: unknown): asserts value is WorkerResult {
  if (!isRecord(value)) throw new Error("Worker result must be an object");

  if (value.status === "completed") {
    if (typeof value.summary !== "string") throw new Error("Completed result missing summary");
    if (!Array.isArray(value.changedFiles))
      throw new Error("Completed result missing changedFiles");
    if (!Array.isArray(value.commits)) throw new Error("Completed result missing commits");
    if (!Array.isArray(value.checks)) throw new Error("Completed result missing checks");
    return;
  }

  if (value.status === "blocked") {
    if (typeof value.reason !== "string") throw new Error("Blocked result missing reason");
    if (typeof value.needsHuman !== "boolean") throw new Error("Blocked result missing needsHuman");
    return;
  }

  if (value.status === "failed") {
    if (typeof value.error !== "string") throw new Error("Failed result missing error");
    return;
  }

  throw new Error("Unknown worker result status");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
