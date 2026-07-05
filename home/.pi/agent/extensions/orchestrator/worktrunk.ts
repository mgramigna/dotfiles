import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type PreparedWorktree = {
  branch: string;
  worktreePath: string;
  worktrunkConfigPath: string;
};

export async function createWorktrunkWorktree(input: {
  cwd: string;
  branch: string;
  baseBranch?: string;
  baseRef?: string;
  worktrunkConfigPath: string;
  logPath: string;
}): Promise<PreparedWorktree> {
  await mkdir(dirname(input.logPath), { recursive: true });
  await appendLog(input.logPath, `# Worktrunk setup ${new Date().toISOString()}\n`);
  await run(input.cwd, "git", ["fetch", "origin"], input.logPath);
  await run(
    input.cwd,
    "wt",
    [
      "switch",
      "--create",
      "--base",
      input.baseRef ?? `origin/${input.baseBranch ?? "dev"}`,
      "--no-cd",
      "--yes",
      input.branch,
    ],
    input.logPath,
  );

  return {
    branch: input.branch,
    worktreePath: await getWorktreePath(input.cwd, input.branch),
    worktrunkConfigPath: input.worktrunkConfigPath,
  };
}

async function getWorktreePath(cwd: string, branch: string): Promise<string> {
  const output = await run(cwd, "git", ["worktree", "list", "--porcelain"]);
  let currentPath: string | undefined;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
      continue;
    }

    if (line === `branch refs/heads/${branch}` && currentPath) return currentPath;
  }

  throw new Error(`Could not find worktree for ${branch}`);
}

function run(cwd: string, command: string, args: string[], logPath?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const commandLine = `$ ${command} ${args.join(" ")}\n`;

    void (logPath ? appendLog(logPath, commandLine) : Promise.resolve());

    execFile(command, args, { cwd }, (error: Error | null, stdout: string, stderr: string) => {
      const log = [stdout, stderr].filter(Boolean).join("\n");
      const logPromise = logPath && log ? appendLog(logPath, `${log}\n`) : Promise.resolve();

      void logPromise.then(() => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        resolve(stdout);
      }, reject);
    });
  });
}

async function appendLog(path: string, text: string): Promise<void> {
  await appendFile(path, text, "utf8");
}
