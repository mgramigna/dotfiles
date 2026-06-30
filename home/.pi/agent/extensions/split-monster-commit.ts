import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 150 * 1024 * 1024,
  });

  return stdout.trimEnd();
}

function fence(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const headChars = Math.floor(maxChars * 0.6);
  const tailChars = maxChars - headChars;
  return [
    text.slice(0, headChars),
    `\n\n... [diff truncated: ${text.length - maxChars} characters omitted] ...\n\n`,
    text.slice(text.length - tailChars),
  ].join("");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

function isConventionalCommit(subject: string): boolean {
  return /^[a-z]+(?:\([^)]+\))?!?:\s+\S/.test(subject);
}

function prTitleFromSubject(subject: string): string {
  return subject.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/, "").trim() || subject;
}

function parseCommitList(raw: string): Array<{ sha: string; subject: string }> {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject = ""] = line.split("\0");
      return { sha, subject };
    });
}

async function defaultBaseBranch(root: string): Promise<string> {
  try {
    const originHead = await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return originHead.replace(/^origin\//, "") || "main";
  } catch {
    return "main";
  }
}

function heuristicPlan(files: string, subject: string): string {
  const lines = files.split("\n").filter(Boolean);
  const groups = new Map<string, string[]>();

  for (const line of lines) {
    const path = line.split(/\s+/).at(-1) ?? line;
    const scope = path.startsWith("api/")
      ? "api"
      : path.startsWith("web/")
        ? "web"
        : path.startsWith("packages/")
          ? "packages"
          : path.startsWith("e2e/")
            ? "e2e"
            : path.startsWith("scripts/")
              ? "scripts"
              : path.includes("test") || path.includes("spec")
                ? "tests"
                : "repo";
    groups.set(scope, [...(groups.get(scope) ?? []), path]);
  }

  const entries = [...groups.entries()];
  if (entries.length === 0) {
    return `1. chore: split changes from ${subject || "HEAD"}`;
  }

  return entries
    .map(([scope, paths], index) => {
      const sample = paths.slice(0, 4).join(", ");
      const suffix = paths.length > 4 ? `, +${paths.length - 4} more` : "";
      return `${index + 1}. ${scope}: commit related changes (${sample}${suffix})`;
    })
    .join("\n");
}

async function recommendPlan(
  ctx: ExtensionCommandContext,
  input: { subject: string; body: string; stat: string; files: string; diff: string },
): Promise<string> {
  const fallback = heuristicPlan(input.files, input.subject);

  if (!ctx.model) return fallback;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) return fallback;

  const prompt = [
    "You are planning how to split one large git commit into small independently reviewable commits.",
    "Recommend a concrete ordered commit-slice plan based only on the diff below.",
    "Rules:",
    "- Return only the editable numbered plan, no preamble.",
    "- Each line should name a likely Conventional Commit scope/type and a clear slice boundary.",
    "- Keep slices independently reviewable and buildable when possible.",
    "- Group schema/types before dependent API/UI code; group tests with the slice they verify unless they are broad e2e coverage.",
    "- Mention important files/hunks when that clarifies the boundary.",
    "",
    `Original subject: ${input.subject}`,
    "",
    "Original body:",
    fence(input.body),
    "",
    "Changed files:",
    fence(input.files),
    "",
    "Diff stat:",
    fence(input.stat),
    "",
    "Diff:",
    fence(truncateMiddle(input.diff, 120_000)),
  ].join("\n");

  try {
    ctx.ui.notify(`Recommending split plan using ${ctx.model.provider}/${ctx.model.id}...`, "info");
    const response = await complete(
      ctx.model,
      {
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: prompt }],
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: auth.apiKey, headers: auth.headers, reasoningEffort: "high", signal: ctx.signal },
    );

    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    return text || fallback;
  } catch (error) {
    ctx.ui.notify(
      `Could not generate an AI split recommendation; using a file-based draft instead. ${
        error instanceof Error ? error.message : String(error)
      }`,
      "warning",
    );
    return fallback;
  }
}

export default function splitMonsterCommit(pi: ExtensionAPI) {
  pi.registerCommand("stack-conventional-prs", {
    description:
      "Turn the current branch's conventional commits into an editable stacked-PR plan and hand off to the agent.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const root = await git(ctx.cwd, ["rev-parse", "--show-toplevel"]);
      const currentBranch = await git(root, ["branch", "--show-current"]);
      const dirty = await git(root, ["status", "--porcelain"]);

      if (!currentBranch) {
        ctx.ui.notify("Cannot create stacked PRs from detached HEAD.", "error");
        return;
      }

      if (dirty) {
        ctx.ui.notify(
          "Working tree is not clean. Commit, stash, or discard local changes before stacking PRs.",
          "error",
        );
        return;
      }

      const suggestedBase = args.trim() || (await defaultBaseBranch(root));
      const baseBranch =
        (await ctx.ui.input("Base branch for the first PR", suggestedBase)) || suggestedBase;

      await git(root, ["fetch", "origin", baseBranch]);
      const baseRef = `origin/${baseBranch}`;
      const mergeBase = await git(root, ["merge-base", baseRef, "HEAD"]);
      const rawCommits = await git(root, [
        "log",
        "--reverse",
        "--format=%H%x00%s",
        `${mergeBase}..HEAD`,
      ]);
      const commits = parseCommitList(rawCommits);
      const conventionalCommits = commits.filter((commit) => isConventionalCommit(commit.subject));

      if (conventionalCommits.length === 0) {
        ctx.ui.notify(`No conventional commits found between ${baseRef} and HEAD.`, "warning");
        return;
      }

      const prefix = `stack/${currentBranch.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
      const plan = conventionalCommits
        .map((commit, index) => {
          const branch = `${prefix}/${String(index + 1).padStart(2, "0")}-${slugify(commit.subject)}`;
          const base = index === 0 ? baseBranch : `${prefix}/${String(index).padStart(2, "0")}-${slugify(conventionalCommits[index - 1].subject)}`;
          const title = prTitleFromSubject(commit.subject);
          return `${index + 1}. ${branch} | base: ${base} | commit: ${commit.sha.slice(0, 12)} | title: ${title}`;
        })
        .join("\n");

      const editedPlan = await ctx.ui.editor(
        "Review stacked PR plan",
        [
          "# Review/edit the stacked PR plan.",
          "# Format: N. branch | base: base-branch | commit: sha | title: PR title",
          "# The agent will create/update each branch at that commit, push it, then create PRs bottom-up.",
          "# Delete lines you do not want included.",
          "",
          plan,
          "",
        ].join("\n"),
      );

      if (!editedPlan?.trim()) {
        ctx.ui.notify("No stacked PR plan provided; nothing changed.", "warning");
        return;
      }

      const finalConfirm = await ctx.ui.confirm(
        "Create stacked PRs?",
        [
          `Current branch: ${currentBranch}`,
          `Base ref: ${baseRef}`,
          `Conventional commits found: ${conventionalCommits.length}`,
          "",
          "Pi will hand this plan to the agent. The agent should show exact git/gh actions before pushing or creating PRs if repo policy requires confirmation.",
          "",
          editedPlan,
          "",
          "Continue?",
        ].join("\n"),
      );

      if (!finalConfirm) return;

      pi.sendUserMessage(
        [
          "Create stacked pull requests from the conventional commits on the current branch.",
          "",
          "Important constraints:",
          "- The working tree was clean when this command started; do not discard unrelated user changes.",
          "- Use the user-approved stacked PR plan below as the source of truth.",
          "- Each PR branch should point at the listed commit SHA, so PR N contains the cumulative history through that commit and targets the previous PR branch (or the base branch for PR 1).",
          "- For each line: create or update the branch at the listed commit, push it to origin, then create a PR with `gh pr create --base <base> --head <branch>` unless an open PR already exists for that branch.",
          "- Use the listed PR title. Build concise Markdown PR bodies that mention the commit SHA and stack position.",
          "- Respect repository git hygiene: before any push, show the planned branches/PRs and wait for explicit user approval if required by loaded project instructions.",
          "- After creating/updating the stack, show PR URLs, `git log --oneline --decorate --max-count=20`, and `git status --short`.",
          "",
          `Current branch: ${currentBranch}`,
          `Bottom base branch: ${baseBranch}`,
          `Merge base: ${mergeBase}`,
          "",
          "All commits in range:",
          fence(commits.map((commit) => `${commit.sha.slice(0, 12)} ${commit.subject}`).join("\n")),
          "",
          "User-approved stacked PR plan:",
          fence(editedPlan),
        ].join("\n"),
      );
    },
  });

  pi.registerCommand("split-monster-commit", {
    description:
      "Interactively plan and split the current HEAD commit into small independently reviewable commits.",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const cwd = ctx.cwd;
      const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
      const currentBranch = await git(root, ["branch", "--show-current"]);
      const dirty = await git(root, ["status", "--porcelain"]);

      if (dirty) {
        ctx.ui.notify(
          "Working tree is not clean. Commit, stash, or discard local changes before splitting.",
          "error",
        );
        return;
      }

      const headSha = await git(root, ["rev-parse", "--short", "HEAD"]);
      const parentSha = await git(root, ["rev-parse", "--short", "HEAD^"]);
      const subject = await git(root, ["log", "-1", "--pretty=%s", "HEAD"]);
      const body = await git(root, ["log", "-1", "--pretty=%B", "HEAD"]);
      const stat = await git(root, ["diff", "--stat", "HEAD^", "HEAD"]);
      const files = await git(root, ["diff", "--name-status", "HEAD^", "HEAD"]);
      const diff = await git(root, ["diff", "--find-renames", "--find-copies", "HEAD^", "HEAD"]);

      const proceed = await ctx.ui.confirm(
        "Split HEAD commit?",
        [
          `Branch: ${currentBranch || "(detached HEAD)"}`,
          `Commit: ${headSha} ${subject}`,
          `Parent: ${parentSha}`,
          "",
          "This command will run `git reset --mixed HEAD^`, leaving the commit's changes unstaged,",
          "then hand off to the agent to create the smaller commits you approve below.",
          "",
          "Your working tree must remain clean until the reset starts.",
          "",
          stat,
        ].join("\n"),
      );

      if (!proceed) return;

      const recommendation = await recommendPlan(ctx, { subject, body, stat, files, diff });
      const defaultPlan = [
        "# Review/edit this recommended split plan before continuing.",
        "# It was generated from `git diff HEAD^ HEAD`; keep each slice buildable/reviewable if possible.",
        "# You can rewrite, reorder, merge, or split these lines.",
        "",
        recommendation,
        "",
      ].join("\n");

      const plan = await ctx.ui.editor("Plan commit slices", defaultPlan);
      if (!plan?.trim()) {
        ctx.ui.notify("No slice plan provided; leaving commit unchanged.", "warning");
        return;
      }

      const finalConfirm = await ctx.ui.confirm(
        "Confirm split",
        [
          "Pi will now uncommit HEAD and ask the agent to create commits matching this plan:",
          "",
          plan,
          "",
          "Continue?",
        ].join("\n"),
      );

      if (!finalConfirm) return;

      await git(root, ["reset", "--mixed", "HEAD^"]);

      ctx.ui.notify("HEAD was reset. Handing off to the agent to create the slices.", "info");

      pi.sendUserMessage(
        [
          "Split the previously-HEAD commit into small independently reviewable commits.",
          "",
          "Important constraints:",
          "- The extension already ran `git reset --mixed HEAD^`; all former commit changes are now unstaged.",
          "- Do not rewrite or discard user changes outside these unstaged changes.",
          "- Use the user-approved slice plan below as the source of truth.",
          "- For each slice: stage only the relevant files/hunks, run an appropriate lightweight verification when feasible, then create one Conventional Commit.",
          "- If a hunk cannot be cleanly assigned or a slice boundary is ambiguous, stop and ask the user before committing it.",
          "- After all slices, show `git log --oneline --decorate --max-count=12` and `git status --short`.",
          "",
          `Original commit: ${headSha} ${subject}`,
          "",
          "Original commit message:",
          fence(body),
          "",
          "Changed files:",
          fence(files),
          "",
          "Diff stat:",
          fence(stat),
          "",
          "User-approved slice plan:",
          fence(plan),
        ].join("\n"),
      );
    },
  });
}
