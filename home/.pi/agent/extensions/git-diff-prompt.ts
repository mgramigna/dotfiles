import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

async function gitDiff(cwd: string, args: string[] = []) {
  const { stdout } = await execFileAsync("git", ["diff", "--no-ext-diff", ...args], {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });

  return stdout.trimEnd();
}

async function gitUntrackedDiff(cwd: string) {
  const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });

  const paths = stdout.split("\0").filter(Boolean);
  const diffs = await Promise.all(
    paths.map(async (path) => {
      try {
        const { stdout: diff } = await execFileAsync(
          "git",
          ["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", path],
          { cwd, maxBuffer: 50 * 1024 * 1024 },
        );

        return diff.trimEnd();
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "stdout" in error &&
          typeof error.stdout === "string"
        ) {
          return error.stdout.trimEnd();
        }

        throw error;
      }
    }),
  );

  return diffs.filter(Boolean).join("\n\n");
}

function combineDiffs(sections: Array<[string, string]>) {
  return sections
    .map(([title, diff]) => diff && `# ${title}\n\n${diff}`)
    .filter(Boolean)
    .join("\n\n");
}

function buildMessage(diff: string, prompt?: unknown) {
  const promptText = typeof prompt === "string" ? prompt.trim() : "";
  const header = promptText.length > 0 ? promptText : "Here is the current git diff:";

  return header + "\n\n```diff\n" + diff + "\n```";
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("summary", {
    description: "Ask the agent to summarize changed files and modified symbols",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      pi.sendUserMessage("Summarize which files changed and the functions/types modified in each");
    },
  });

  pi.registerCommand("diff", {
    description: "Send the current unstaged git diff to the agent, optionally prefixed by a prompt",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const [unstaged, untracked] = await Promise.all([gitDiff(ctx.cwd), gitUntrackedDiff(ctx.cwd)]);
      const diff = combineDiffs([
        ["Unstaged changes", unstaged],
        ["Untracked files", untracked],
      ]);

      if (!diff) {
        ctx.ui.notify("No unstaged git diff or untracked files found.", "info");
        return;
      }

      pi.sendUserMessage(buildMessage(diff, args));
    },
  });

  pi.registerCommand("diff-staged", {
    description: "Send the staged git diff to the agent, optionally prefixed by a prompt",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const diff = await gitDiff(ctx.cwd, ["--cached"]);
      if (!diff) {
        ctx.ui.notify("No staged git diff found.", "info");
        return;
      }

      pi.sendUserMessage(buildMessage(diff, args));
    },
  });

  pi.registerCommand("diff-all", {
    description: "Send staged plus unstaged git diffs to the agent, optionally prefixed by a prompt",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const [staged, unstaged, untracked] = await Promise.all([
        gitDiff(ctx.cwd, ["--cached"]),
        gitDiff(ctx.cwd),
        gitUntrackedDiff(ctx.cwd),
      ]);

      const diff = combineDiffs([
        ["Staged changes", staged],
        ["Unstaged changes", unstaged],
        ["Untracked files", untracked],
      ]);

      if (!diff) {
        ctx.ui.notify("No git diff or untracked files found.", "info");
        return;
      }

      pi.sendUserMessage(buildMessage(diff, args));
    },
  });
}
