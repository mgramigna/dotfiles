import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";

import type { WorkerState } from "./state";
import type { WorkerFiles } from "./storage";

export type PiWorkerSpawnMode = "background" | "headed";

export type SpawnedPiWorker = {
  pid?: number;
  stdoutPath: string;
  stderrPath: string;
  sessionFile?: string;
};

export function spawnPiWorker(input: {
  worker: WorkerState;
  files: WorkerFiles;
  runId: string;
  mode?: PiWorkerSpawnMode;
}): SpawnedPiWorker {
  if (input.mode === "headed") return spawnHeadedPiWorker(input);

  const stdout = openSync(input.files.stdoutPath, "a");
  const stderr = openSync(input.files.stderrPath, "a");
  const child = spawn(
    "pi",
    ["--approve", "--name", input.worker.id, "-p", `@${input.worker.promptPath}`],
    {
      cwd: input.worker.worktreePath,
      detached: true,
      stdio: ["ignore", stdout, stderr],
    },
  );

  child.unref();

  if (!child.pid) throw new Error("Pi worker did not start");

  return {
    pid: child.pid,
    stdoutPath: input.files.stdoutPath,
    stderrPath: input.files.stderrPath,
  };
}

function spawnHeadedPiWorker(input: {
  worker: WorkerState;
  files: WorkerFiles;
  runId: string;
}): SpawnedPiWorker {
  assertHerdrEnv();

  execFileSync(
    "herdr",
    [
      "agent",
      "start",
      input.worker.id,
      "--cwd",
      input.worker.worktreePath,
      "--tab",
      process.env.HERDR_TAB_ID ?? "",
      "--split",
      "right",
      "--no-focus",
      "--",
      "pi",
      "--approve",
      "--name",
      input.worker.id,
      `@${input.worker.promptPath}`,
    ],
    { stdio: "pipe" },
  );

  return {
    stdoutPath: `herdr:${input.worker.id}`,
    stderrPath: `herdr:${input.worker.id}`,
    sessionFile: `herdr:${input.worker.id}`,
  };
}

function assertHerdrEnv(): void {
  if (
    process.env.HERDR_ENV !== "1" ||
    !process.env.HERDR_SOCKET_PATH ||
    !process.env.HERDR_TAB_ID
  ) {
    throw new Error("--headed requires Herdr env; run inside Herdr or omit --headed");
  }

  if (!existsSync(process.env.HERDR_SOCKET_PATH)) {
    throw new Error("--headed requires active Herdr socket; run inside Herdr or omit --headed");
  }
}
