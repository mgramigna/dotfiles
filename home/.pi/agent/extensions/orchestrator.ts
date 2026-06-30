import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

interface OrchestratorIssue {
  id: string;
  title: string;
  prompt: string;
  branch?: string;
  dependsOn?: string;
  status?: "pending" | "in_progress" | "committed";
  summary?: string;
  commit?: string;
}

interface OrchestratorRun {
  runId: string;
  baseBranch: string;
  branchPrefix?: string;
  currentIndex: number;
  auto: boolean;
  status: "running" | "complete" | "stopped";
  issues: OrchestratorIssue[];
}

const GLOBAL_STATE_ROOT = join(homedir(), ".pi", "agent", "orchestrator");
const STATE_FILE = "state.json";

function sh(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "slice";
}

function projectRoot(cwd: string) {
  try {
    return sh(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return cwd;
  }
}

function projectStateDir(cwd: string) {
  const root = projectRoot(cwd);
  const hash = createHash("sha1").update(root).digest("hex").slice(0, 10);
  return join(GLOBAL_STATE_ROOT, `${slug(basename(root))}-${hash}`);
}

function statePath(cwd: string) {
  return join(projectStateDir(cwd), STATE_FILE);
}

function loadState(cwd: string): OrchestratorRun | undefined {
  const p = statePath(cwd);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveState(cwd: string, state: OrchestratorRun) {
  mkdirSync(projectStateDir(cwd), { recursive: true });
  writeFileSync(statePath(cwd), JSON.stringify(state, null, 2) + "\n");
}

function planPath(cwd: string, runId: string) {
  return join(projectStateDir(cwd), `${slug(runId)}.orchestrator.json`);
}

function isGitHubIssueUrl(value: string) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:[?#].*)?$/i.test(value);
}

function gh(args: string[], cwd: string) {
  return execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readGitHubIssue(cwd: string, url: string) {
  const raw = gh(["issue", "view", url, "--json", "url,number,title,body,comments"], cwd);
  const issue = JSON.parse(raw);
  const comments = (issue.comments ?? [])
    .map((c: { author?: { login?: string }; createdAt?: string; body?: string }, idx: number) => `### Comment ${idx + 1} by ${c.author?.login ?? "unknown"} at ${c.createdAt ?? "unknown"}\n${c.body ?? ""}`)
    .join("\n\n");
  return {
    path: url,
    content: `# GitHub Issue #${issue.number}: ${issue.title}\n\nURL: ${issue.url}\n\n## Body\n${issue.body ?? ""}${comments ? `\n\n## Comments\n${comments}` : ""}`,
  };
}

function readPrdFiles(path: string) {
  const files: Array<{ path: string; content: string }> = [];
  const addFile = (file: string) => {
    if (!/\.(md|mdx|txt|json|ya?ml)$/i.test(file)) return;
    files.push({ path: file, content: readFileSync(file, "utf8") });
  };
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) addFile(full);
    }
  };
  const stat = statSync(path);
  if (stat.isDirectory()) walk(path);
  else addFile(path);
  return files;
}

function githubIssueUrls(text: string) {
  return Array.from(new Set(text.match(/https:\/\/github\.com\/[^\s)\]>"']+\/[^\s)\]>"']+\/issues\/\d+/gi) ?? []));
}

function readPrdSources(cwd: string, sources: string[]) {
  const seen = new Set<string>();
  const files: Array<{ path: string; content: string }> = [];
  const addGithubIssue = (url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    files.push(readGitHubIssue(cwd, url));
  };

  for (const source of sources) {
    if (isGitHubIssueUrl(source)) addGithubIssue(source);
    else files.push(...readPrdFiles(resolve(cwd, source)));
  }

  // Also pull in GitHub issue URLs linked from PRD files or parent issues. This supports
  // parent PRD issues that link to sub-PRD/subtask issues without requiring every URL
  // to be passed on the command line.
  for (const file of [...files]) {
    for (const url of githubIssueUrls(file.content)) addGithubIssue(url);
  }

  return files;
}

function planningPrompt(cwd: string, prdSources: string[], auto: boolean) {
  const files = readPrdSources(cwd, prdSources);
  const body = files.map((f) => `--- SOURCE: ${f.path}\n${f.content}`).join("\n\n");
  const currentBranch = sh(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return `Convert these PRD sources into an orchestrator plan.\n\nSources:\n${prdSources.map((s) => `- ${s}`).join("\n")}\nCurrent git branch: ${currentBranch}\n\nCreate a JSON plan with this exact shape:\n{\n  "runId": "short-kebab-name",\n  "baseBranch": "${currentBranch}",\n  "branchPrefix": "prd/<short-kebab-name>",\n  "issues": [\n    { "id": "<runId>-01", "title": "...", "prompt": "..." }\n  ]\n}\n\nGuidelines:\n- Break the PRD into reviewable stacked slices that depend on each other.\n- Each slice should be independently reviewable and small enough for one PR.\n- Include acceptance criteria, relevant files/areas, tests/checks, and non-goals in each issue prompt.\n- Preserve dependency order in the issues array.\n- Do not implement anything yet.\n- When the plan is ready, call orchestrator_save_plan with the plan and start=${auto}.
- The extension will save orchestrator state outside the repo under ~/.pi/agent/orchestrator; do not write plan/state files into the project.\n\nPRD/GitHub issue contents:\n${body}`;
}

function issueBranch(state: OrchestratorRun, issue: OrchestratorIssue, index: number) {
  if (issue.branch) return issue.branch;
  const prefix = state.branchPrefix ?? `orchestrator/${slug(state.runId)}`;
  return `${prefix}-${String(index + 1).padStart(2, "0")}-${slug(issue.title)}`;
}

function currentIssue(state: OrchestratorRun) {
  return state.issues[state.currentIndex];
}

function kickoffPrompt(state: OrchestratorRun) {
  const issue = currentIssue(state);
  const prior = state.issues
    .slice(0, state.currentIndex)
    .map((i, idx) => `${idx + 1}. ${i.id}: ${i.title}\nSummary: ${i.summary ?? "n/a"}\nCommit: ${i.commit ?? "n/a"}`)
    .join("\n\n");

  return `You are implementing a stacked PRD slice managed by the global orchestrator extension.\n\nRun: ${state.runId}\nSlice ${state.currentIndex + 1} of ${state.issues.length}\nIssue: ${issue.id} — ${issue.title}\n\nIssue prompt:\n${issue.prompt}\n\nPrevious committed slices:\n${prior || "None"}\n\nInstructions:\n- Implement only this slice.\n- Preserve the stack; do not switch branches unless explicitly needed.\n- Run relevant checks/tests.\n- When implementation is ready, call orchestrator_request_review with a concise implementation summary and checks run.\n- If review asks for changes, make them and request review again.\n- Do not commit manually; orchestrator_review_pass will commit for you.`;
}

const ORCHESTRATOR_HELP = `Orchestrator commands:
- /orchestrator-plan <prd-path|github-issue-url...>
  Convert PRD files or GitHub issues into a JSON plan and save it under ~/.pi/agent/orchestrator.
- /orchestrator-start <json|prd-path|github-issue-url...> [--hitl]
  Start from an existing JSON plan, or ask the agent to create a plan from PRD sources. By default it auto-continues slices; --hitl pauses after each committed slice.
- /orchestrator-continue
  Start the next pending slice for the current run.
- /orchestrator-status
  Show the saved state for the current repository.
- /orchestrator-stop
  Mark the current run as stopped.
- /orchestrator-help
  Show this help.

Typical flow:
1. /orchestrator-plan docs/prd.md
2. Inspect the generated plan, or let /orchestrator-start docs/prd.md create and start one.
3. The agent implements each slice, requests review, commits, then continues unless --hitl was used.`;

function prepareBranch(cwd: string, state: OrchestratorRun) {
  const idx = state.currentIndex;
  const issue = currentIssue(state);
  const branch = issueBranch(state, issue, idx);
  const parent = idx === 0 ? state.baseBranch : issueBranch(state, state.issues[idx - 1], idx - 1);

  sh(cwd, ["checkout", parent]);
  const branches = sh(cwd, ["branch", "--list", branch]);
  if (branches) sh(cwd, ["checkout", branch]);
  else sh(cwd, ["checkout", "-b", branch]);

  issue.branch = branch;
  issue.status = "in_progress";
  saveState(cwd, state);
  return branch;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("orchestrator-help", {
    description: "Show orchestrator command help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(ORCHESTRATOR_HELP, "info");
    },
  });

  pi.registerCommand("orchestrator-start", {
    description: "Start an orchestrator run from JSON, PRD paths, or GitHub issue URLs: /orchestrator-start <json|prd-path|issue-url...> [--hitl]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.includes("help") || parts.includes("--help") || parts.includes("-h")) {
        ctx.ui.notify(ORCHESTRATOR_HELP, "info");
        return;
      }
      const sources = parts.filter((p) => !p.startsWith("--"));
      if (sources.length === 0) {
        ctx.ui.notify("Usage: /orchestrator-start <json|prd-path|github-issue-url...> [--hitl]", "error");
        return;
      }
      const auto = !parts.includes("--hitl");
      const file = sources[0];
      const isSingleJsonPlan = sources.length === 1 && !isGitHubIssueUrl(file) && file.endsWith(".json") && existsSync(resolve(ctx.cwd, file));
      if (!isSingleJsonPlan) {
        pi.sendUserMessage(planningPrompt(ctx.cwd, sources, auto));
        return;
      }
      const full = resolve(ctx.cwd, file);
      const input = JSON.parse(readFileSync(full, "utf8"));
      const state: OrchestratorRun = {
        runId: input.runId,
        baseBranch: input.baseBranch,
        branchPrefix: input.branchPrefix,
        currentIndex: 0,
        auto,
        status: "running",
        issues: input.issues.map((i: OrchestratorIssue) => ({ ...i, status: "pending" })),
      };
      const branch = prepareBranch(ctx.cwd, state);
      await ctx.newSession({
        parentSession: ctx.sessionManager.getSessionFile(),
        withSession: async (nextCtx) => {
          nextCtx.ui.notify(`Orchestrator run started on ${branch}`, "info");
          await nextCtx.sendUserMessage(kickoffPrompt(state));
        },
      });
    },
  });

  pi.registerCommand("orchestrator-plan", {
    description: "Convert PRD paths or GitHub issue URLs into an orchestrator JSON plan without starting: /orchestrator-plan <prd-path|issue-url...>",
    handler: async (args, ctx) => {
      const sources = args.trim().split(/\s+/).filter(Boolean);
      if (sources.includes("help") || sources.includes("--help") || sources.includes("-h")) {
        ctx.ui.notify(ORCHESTRATOR_HELP, "info");
        return;
      }
      if (sources.length === 0) return ctx.ui.notify("Usage: /orchestrator-plan <prd-path|github-issue-url...>", "error");
      pi.sendUserMessage(planningPrompt(ctx.cwd, sources, false));
    },
  });

  pi.registerCommand("orchestrator-continue", {
    description: "Continue the current orchestrator run with the next issue",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (!state || state.status !== "running") return ctx.ui.notify("No running orchestrator", "error");
      if (state.currentIndex >= state.issues.length) return ctx.ui.notify("Orchestrator already complete", "info");
      const branch = prepareBranch(ctx.cwd, state);
      await ctx.newSession({
        parentSession: ctx.sessionManager.getSessionFile(),
        withSession: async (nextCtx) => {
          nextCtx.ui.notify(`Continuing orchestrator on ${branch}`, "info");
          await nextCtx.sendUserMessage(kickoffPrompt(state));
        },
      });
    },
  });

  pi.registerCommand("orchestrator-status", {
    description: "Show current orchestrator state",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      ctx.ui.notify(state ? JSON.stringify(state, null, 2) : "No orchestrator state found", "info");
    },
  });

  pi.registerCommand("orchestrator-stop", {
    description: "Mark the current orchestrator run as stopped",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No orchestrator state found", "error");
      state.status = "stopped";
      saveState(ctx.cwd, state);
      ctx.ui.notify("Orchestrator stopped", "info");
    },
  });

  pi.registerTool({
    name: "orchestrator_save_plan",
    label: "Orchestrator Save Plan",
    description: "Save a PRD-derived orchestrator plan and optionally start it.",
    parameters: Type.Object({
      plan: Type.Object({
        runId: Type.String(),
        baseBranch: Type.String(),
        branchPrefix: Type.Optional(Type.String()),
        issues: Type.Array(Type.Object({
          id: Type.String(),
          title: Type.String(),
          prompt: Type.String(),
          dependsOn: Type.Optional(Type.String()),
        })),
      }),
      start: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const out = planPath(ctx.cwd, params.plan.runId);
      mkdirSync(projectStateDir(ctx.cwd), { recursive: true });
      writeFileSync(out, JSON.stringify(params.plan, null, 2) + "\n");
      if (params.start) pi.sendUserMessage(`/orchestrator-start ${out}`, { deliverAs: "followUp" });
      return { content: [{ type: "text", text: `Saved orchestrator plan to ${out}${params.start ? " and queued start." : ""}` }] };
    },
  });

  pi.registerTool({
    name: "orchestrator_request_review",
    label: "Orchestrator Request Review",
    description: "Request overseer review for the current orchestrator slice after implementation is ready.",
    parameters: Type.Object({
      summary: Type.String(),
      checks: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      pi.sendUserMessage("/overseer review", { deliverAs: "followUp" });
      pi.sendUserMessage(`Orchestrator review requested for the current slice.\n\nImplementation summary:\n${params.summary}\n\nChecks run:\n${params.checks ?? "Not specified"}\n\nI queued /overseer review in a separate herdr pane. Wait for the overseer completion message before proceeding. When it arrives, inspect and acknowledge the overseer output.\n\nDecision rules:\n- If overseer reports VERIFIED findings, fix them, rerun relevant checks, then call orchestrator_request_review again.\n- Treat HUNCH/QUESTION items as leads: verify or explain why no change is needed.\n- Only call orchestrator_review_pass after you have seen the overseer output and either addressed or explicitly dismissed every finding.\n- If overseer reports no defensible issues and checks are acceptable, call orchestrator_review_pass with a concise summary and a Conventional Commits commit message.`, { deliverAs: "followUp" });
      return { content: [{ type: "text", text: "Queued /overseer review and follow-up instructions." }] };
    },
  });

  pi.registerTool({
    name: "orchestrator_review_pass",
    label: "Orchestrator Review Pass",
    description: "Mark review passed, commit current slice, and continue unless the run is in --hitl mode.",
    parameters: Type.Object({
      summary: Type.String(),
      commitMessage: Type.String(),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = loadState(ctx.cwd);
      if (!state) return { isError: true, content: [{ type: "text", text: "No orchestrator state found." }] };
      const issue = currentIssue(state);
      sh(ctx.cwd, ["add", "-A"]);
      sh(ctx.cwd, ["commit", "-m", params.commitMessage]);
      const commit = sh(ctx.cwd, ["rev-parse", "--short", "HEAD"]);
      issue.status = "committed";
      issue.summary = params.summary;
      issue.commit = commit;
      state.currentIndex += 1;
      if (state.currentIndex >= state.issues.length) state.status = "complete";
      saveState(ctx.cwd, state);
      if (state.status === "running" && state.auto) pi.sendUserMessage("/orchestrator-continue", { deliverAs: "followUp" });
      return { content: [{ type: "text", text: state.status === "complete" ? "Orchestrator complete." : `Committed ${commit}. ${state.auto ? "Queued next issue." : "Run /orchestrator-continue for next issue."}` }] };
    },
  });
}
