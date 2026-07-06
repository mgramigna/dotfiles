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

      const diff = await gitDiff(ctx.cwd);
      if (!diff) {
        ctx.ui.notify("No unstaged git diff found.", "info");
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

      const [staged, unstaged] = await Promise.all([
        gitDiff(ctx.cwd, ["--cached"]),
        gitDiff(ctx.cwd),
      ]);

      if (!staged && !unstaged) {
        ctx.ui.notify("No git diff found.", "info");
        return;
      }

      const combined = [
        staged && `# Staged changes\n\n${staged}`,
        unstaged && `# Unstaged changes\n\n${unstaged}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      pi.sendUserMessage(buildMessage(combined, args));
    },
  });
}
