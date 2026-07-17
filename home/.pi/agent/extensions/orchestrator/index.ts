import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type OrchestratorConfig,
  type OrchestratorPublishMode,
  type OrchestratorThinkingLevel,
  getConfigPath,
  getGlobalConfigPath,
  loadOptionalConfig,
  loadOrchestratorConfig,
} from "./config";
import { detectGitHubRepo, fetchParentAndSlices } from "./github";
import { type PiWorkerSpawnMode, spawnPiWorker } from "./pi-worker";
import {
  type OrchestratorRunState,
  completeSliceWorker,
  createInitialRunState,
  failSliceWorker,
  getReadySliceIssueNumbers,
  markWorkerRunning,
  refreshSliceReadiness,
  startSliceWorker,
} from "./state";
import {
  appendRunEvent,
  ensureRunLayout,
  getRunDir,
  getWorkerFiles,
  loadRunState,
  readWorkerResult,
  saveRunState,
  writeWorkerPrompt,
} from "./storage";
import { buildWorkerPrompt } from "./worker-prompt";
import { autocompleteSelect } from "../../shared/autocomplete-select";
import { createWorktrunkWorktree } from "./worktrunk";

type CommandContext = {
  cwd: string;
  isProjectTrusted?: () => boolean;
  ui: {
    notify: (message: string, level: "info" | "error" | "warning" | "success") => void;
    input?: (prompt: string, placeholder?: string) => Promise<string | undefined>;
    select?: (title: string, choices: string[]) => Promise<string | undefined>;
    confirm?: (title: string, message: string) => Promise<boolean>;
    setStatus?: (key: string, value: string | undefined) => void;
    theme?: { fg: (color: string, text: string) => string; bold: (text: string) => string };
    setWidget?: (
      key: string,
      value: string[] | undefined,
      options?: { placement?: "aboveEditor" | "belowEditor" },
    ) => void;
  };
};

export default function (pi: {
  registerCommand: (
    name: string,
    command: {
      description: string;
      getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string; description?: string }> | null;
      handler: (args: string, ctx: CommandContext) => Promise<void>;
    },
  ) => void;
}) {
  const runOrchestrateCommand = async (args: string, ctx: CommandContext) => {
    const parsed = parseArgs(args);
    const parentIssueNumber = parseIssueNumber(parsed.issue);

    if (!parentIssueNumber) {
      ctx.ui.notify("Usage: /orchestrate <issue-url|issue-number> [--headed] [--stack|--no-pr]", "info");
      return;
    }

    const runId = `prd-${parentIssueNumber}`;
    const progress = createProgress(ctx.ui, runId);

    try {
      const trusted = ctx.isProjectTrusted?.() ?? true;
      const result = await runOrchestratorHeadless({
        cwd: ctx.cwd,
        parentIssueNumber,
        trusted,
        mode: parsed.mode,
        onProgress: progress.update,
        resetMainWorktree: false,
        freshRun: false,
        publishMode: parsed.publishMode,
      });
      ctx.ui.notify(result, "info");
    } finally {
      progress.clear();
    }
  };

  pi.registerCommand("orchestrate", {
    description: "Run PRD orchestration from a GitHub issue URL/number",
    getArgumentCompletions(prefix) {
      const items = [
        { value: "--headed", label: "--headed", description: "Run workers in headed mode" },
        { value: "--stack", label: "--stack", description: "Publish using stacked PRs" },
        { value: "--no-pr", label: "--no-pr", description: "Do not publish PRs" },
      ];
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: runOrchestrateCommand,
  });

  pi.registerCommand("orchestrate-doctor", {
    description: "Check PRD orchestration setup",
    handler: async (_args, ctx) => {
      ctx.ui.notify(await runDoctor(ctx), "info");
    },
  });

  pi.registerCommand("orchestrate-setup", {
    description: "Create .pi/orchestrator.json interactively if it does not exist",
    handler: async (_args, ctx) => {
      ctx.ui.notify(await runSetup(ctx), "info");
    },
  });

  const setupCommand = async (args: string, ctx: CommandContext) => {
    const command = args.trim().split(/\s+/).filter(Boolean)[0] || "help";
    if (command !== "setup") {
      ctx.ui.notify("Usage: /orchestrator setup", "info");
      return;
    }
    ctx.ui.notify(await runSetup(ctx), "info");
  };

  pi.registerCommand("orchestrator", {
    description: "Orchestrator commands: setup",
    getArgumentCompletions(prefix) {
      const items = [{ value: "setup", label: "setup", description: "Create .pi/orchestrator.json interactively" }];
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: setupCommand,
  });

  pi.registerCommand("orcehstrator", {
    description: "Typo-compatible alias for /orchestrator setup",
    handler: setupCommand,
  });

  pi.registerCommand("orchestrate-status", {
    description: "Show PRD orchestration status",
    handler: async (args, ctx) => {
      const parentIssueNumber = parseIssueNumber(args.trim());

      if (!parentIssueNumber) {
        ctx.ui.notify("Usage: /orchestrate-status <issue-url|issue-number>", "info");
        return;
      }

      ctx.ui.notify(
        formatRunStatus(await loadRunState(ctx.cwd, `prd-${parentIssueNumber}`)),
        "info",
      );
    },
  });
}

export async function runOrchestratorHeadless(input: {
  cwd: string;
  parentIssueNumber: number;
  trusted?: boolean;
  mode?: PiWorkerSpawnMode;
  onProgress?: (progress: Progress) => void;
  resetMainWorktree?: boolean;
  freshRun?: boolean;
  publishMode?: OrchestratorPublishMode;
}): Promise<string> {
  if (input.resetMainWorktree ?? true) await resetMainWorktreeToDefaultBranch(input.cwd);
  if (input.freshRun ?? true) {
    await rm(getRunDir(input.cwd, `prd-${input.parentIssueNumber}`), { recursive: true, force: true });
  }

  const config = await loadOrchestratorConfig({
    cwd: input.cwd,
    trusted: input.trusted ?? true,
  });
  const repo = await detectGitHubRepo(input.cwd);
  await ensureRun(input.cwd, repo, input.parentIssueNumber);

  return runLoop(
    input.cwd,
    repo,
    input.parentIssueNumber,
    input.onProgress ?? (() => undefined),
    input.mode ?? "background",
    input.publishMode ? { ...config, publishMode: input.publishMode } : config,
  );
}

async function resetMainWorktreeToDefaultBranch(cwd: string): Promise<void> {
  await runCommand("git", ["fetch", "origin"], { cwd });
  const trunkBranch = await getTrunkBranch(cwd);
  await runCommand("git", ["switch", trunkBranch], { cwd });
  await runCommand("git", ["reset", "--hard", `origin/${trunkBranch}`], { cwd });
}

async function runDoctor(ctx: CommandContext): Promise<string> {
  const trusted = ctx.isProjectTrusted?.() ?? true;
  const checks: string[] = [];

  checks.push(await doctorCheck("git repo", async () => {
    await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd });
  }));
  checks.push(await doctorCheck("gh auth", async () => {
    await runCommand("gh", ["auth", "status"], { cwd: ctx.cwd });
  }));
  checks.push(await doctorCheck("GitHub repo", async () => {
    await detectGitHubRepo(ctx.cwd);
  }));
  checks.push(await doctorCheck("wt", async () => {
    await runCommand("wt", ["switch", "--help"], { cwd: ctx.cwd });
  }));
  checks.push(trusted ? "ok project trusted" : "warn project not trusted; project .pi/orchestrator.json ignored");
  const globalPath = getGlobalConfigPath();
  const projectPath = getConfigPath(ctx.cwd);
  const globalExists = await pathExists(globalPath);
  const projectExists = trusted ? await pathExists(projectPath) : false;

  checks.push(globalExists
    ? await doctorCheck(`global config ${globalPath}`, async () => {
      await loadOptionalConfig(globalPath);
    })
    : `warn global config not found ${globalPath}`);
  checks.push(!trusted
    ? `warn project config ignored ${projectPath}`
    : projectExists
      ? await doctorCheck(`project config ${projectPath}`, async () => {
        await loadOptionalConfig(projectPath);
      })
      : `ok no project config ${projectPath}`);

  const config = await loadOrchestratorConfig({ cwd: ctx.cwd, trusted }).catch(() => undefined);
  if (config) {
    const sources = ["defaults", globalExists ? "global" : undefined, projectExists ? "project" : undefined]
      .filter((source): source is string => Boolean(source));
    checks.push(`ok config sources ${sources.join(" + ")}`);
    checks.push(
      config.checks.length
        ? `ok checks ${config.checks.length}`
        : "warn no checks configured",
    );
    checks.push(`ok maxParallel ${config.maxParallel}`);
    checks.push(`ok publishMode ${config.publishMode}`);
    checks.push(config.model ? `ok model ${config.model}` : "ok model default");
    checks.push(config.thinking ? `ok thinking ${config.thinking}` : "ok thinking default");
  }

  return ["orchestrator doctor", ...checks].join("\n");
}

async function doctorCheck(name: string, check: () => Promise<void>): Promise<string> {
  try {
    await check();
    return `ok ${name}`;
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : String(error);
    return `fail ${name}: ${message.split("\n")[0] ?? message}`;
  }
}

async function runSetup(ctx: CommandContext): Promise<string> {
  const input = ctx.ui.input;
  const confirm = ctx.ui.confirm;
  if (!confirm) return "Orchestrator setup requires a UI confirm prompt, but this Pi build does not expose one.";

  const projectPath = getConfigPath(ctx.cwd);
  const globalPath = getGlobalConfigPath();
  const scope = await autocompleteSelect(ctx, {
    title: "Create orchestrator config",
    items: [
      `Global (${globalPath})`,
      `Project (${projectPath})`,
      "Cancel",
    ].map((choice) => ({ value: choice, label: choice })),
    maxVisible: 3,
  });
  if (!scope || scope === "Cancel") return "Orchestrator setup cancelled.";
  if (scope.startsWith("Project") && ctx.isProjectTrusted?.() === false) {
    return "Project is not trusted; refusing to write project .pi/orchestrator.json.";
  }

  const path = scope.startsWith("Global") ? globalPath : projectPath;
  const existingConfig = await readConfigObjectIfExists(path);

  const currentModel = currentModelArg(ctx);
  const models = await listAvailableModels(ctx.cwd);
  const modelChoices = [
    ...(currentModel ? [`Use current model (${currentModel})`] : []),
    ...models.filter((model) => model !== currentModel),
    "Enter manually",
    "Cancel",
  ];
  const modelChoice = await autocompleteSelect(ctx, {
    title: "Orchestrator worker model",
    items: modelChoices.map((choice) => ({ value: choice, label: choice })),
    maxVisible: 12,
    noMatchText: "  No matching models",
  });
  if (!modelChoice || modelChoice === "Cancel") return "Orchestrator setup cancelled.";

  let model: string | undefined;
  if (modelChoice === "Enter manually") {
    if (!input) return "Manual model entry requires a UI input prompt, but this Pi build does not expose one.";
    model = (await input("Orchestrator worker model", "provider/model-id"))?.trim();
    if (!model) return "Orchestrator setup cancelled.";
  } else if (modelChoice.startsWith("Use current model (")) {
    model = currentModel;
  } else {
    model = modelChoice;
  }

  const thinkingChoice = await autocompleteSelect(ctx, {
    title: "Orchestrator worker thinking level",
    items: ["Default", "off", "minimal", "low", "medium", "high", "xhigh", "Cancel"].map((choice) => ({ value: choice, label: choice })),
    maxVisible: 8,
  });
  if (!thinkingChoice || thinkingChoice === "Cancel") return "Orchestrator setup cancelled.";
  const thinking = thinkingChoice === "Default" ? undefined : parseSetupThinking(thinkingChoice);

  const maxParallelInput = (await input?.("Max parallel workers:", "2"))?.trim();
  const maxParallel = maxParallelInput ? Number(maxParallelInput) : 2;
  if (!Number.isSafeInteger(maxParallel) || maxParallel < 1) throw new Error("maxParallel must be a positive integer");

  const publishModeChoice = await autocompleteSelect(ctx, {
    title: "Orchestrator publish mode",
    items: [
      "Single PR",
      "Stacked PRs",
      "No PR",
      "Cancel",
    ].map((choice) => ({ value: choice, label: choice })),
    maxVisible: 4,
  });
  if (!publishModeChoice || publishModeChoice === "Cancel") return "Orchestrator setup cancelled.";
  const publishMode = parseSetupPublishMode(publishModeChoice);

  const config = {
    maxParallel,
    publishMode,
    ...(existingConfig ? {} : { checks: [] }),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
  };
  const nextConfig = { ...(existingConfig ?? {}), ...config };
  const before = existingConfig ? JSON.stringify(existingConfig, null, 2) + "\n" : "";
  const after = JSON.stringify(nextConfig, null, 2) + "\n";
  if (before === after) return `Orchestrator config at ${path} already matches setup selections; no changes made.`;
  const ok = await confirm(
    existingConfig ? "Update orchestrator config?" : "Create orchestrator config?",
    `Path: ${path}\n\n${formatJsonDiff(before, after)}`,
  );
  if (!ok) return "Orchestrator setup cancelled; no changes made.";

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, after, "utf8");
  return `${existingConfig ? "Updated" : "Created"} orchestrator config at ${path}.`;
}

async function readConfigObjectIfExists(path: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`orchestrator config at ${path} must be an object`);
  await loadOptionalConfig(path);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatJsonDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  return [
    "Config diff:",
    ...beforeLines.filter((line) => line.length > 0).map((line) => `- ${line}`),
    ...afterLines.filter((line) => line.length > 0).map((line) => `+ ${line}`),
  ].join("\n");
}

async function listAvailableModels(cwd: string): Promise<string[]> {
  try {
    const output = await runCommand("pi", ["--list-models"], { cwd });
    return output.split("\n").slice(1).map((line) => {
      const [provider, model] = line.trim().split(/\s+/);
      return provider && model ? `${provider}/${model}` : undefined;
    }).filter((model): model is string => Boolean(model));
  } catch {
    return [];
  }
}

function currentModelArg(ctx: CommandContext): string | undefined {
  const model = (ctx as any).model;
  if (!model?.id) return undefined;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

function parseSetupThinking(value: string): OrchestratorThinkingLevel {
  const allowed = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
  if (!allowed.includes(value as OrchestratorThinkingLevel)) {
    throw new Error(`thinking must be one of: ${allowed.join(", ")}`);
  }
  return value as OrchestratorThinkingLevel;
}

function parseSetupPublishMode(value: string): OrchestratorPublishMode {
  switch (value) {
    case "Single PR":
      return "single-pr";
    case "Stacked PRs":
      return "stacked-prs";
    case "No PR":
      return "none";
    default:
      throw new Error("publish mode must be Single PR, Stacked PRs, or No PR");
  }
}

async function ensureRun(cwd: string, repo: string, parentIssueNumber: number): Promise<void> {
  const runId = `prd-${parentIssueNumber}`;

  try {
    await loadRunState(cwd, runId);
    return;
  } catch {
    const { parent, slices } = await fetchParentAndSlices({
      cwd,
      repo,
      parentIssueNumber,
    });
    const state = createInitialRunState({ runId, parent, slices });

    await ensureRunLayout(cwd, runId);
    await saveRunState(cwd, state);
    await appendRunEvent(cwd, runId, {
      type: "init",
      at: new Date().toISOString(),
      parentIssueNumber,
      issueNumbers: state.plan.sliceIssueNumbers,
    });
  }
}

async function runLoop(
  cwd: string,
  repo: string,
  parentIssueNumber: number,
  onProgress: (progress: Progress) => void,
  spawnMode: PiWorkerSpawnMode,
  config: OrchestratorConfig,
): Promise<string> {
  const runId = `prd-${parentIssueNumber}`;
  const pollMs = 30_000;

  for (let iteration = 1; iteration <= 1_000; iteration += 1) {
    const state = await loadRunState(cwd, runId);
    onProgress({ phase: "checking", runId, iteration, state });

    const status = getRunStatus(state);
    if (status === "failed")
      return [`run: ${runId}`, "decision: paused; minion failed/blocked"].join("\n");
    if (status === "complete") return integrateRun(cwd, parentIssueNumber, config);

    const tickResult = await tickRun(cwd, repo, parentIssueNumber, spawnMode, config);
    const nextState = await loadRunState(cwd, runId);
    onProgress({
      phase: "running",
      runId,
      iteration,
      state: nextState,
      last: summarize(tickResult),
    });

    const nextStatus = getRunStatus(nextState);
    if (nextStatus === "failed")
      return [`run: ${runId}`, "decision: paused; minion failed/blocked", tickResult].join("\n");
    if (nextStatus === "complete") return integrateRun(cwd, parentIssueNumber, config);

    await sleep(pollMs);
  }

  return [`run: ${runId}`, "decision: paused; max iterations"].join("\n");
}

async function tickRun(
  cwd: string,
  repo: string,
  parentIssueNumber: number,
  spawnMode: PiWorkerSpawnMode,
  config: OrchestratorConfig,
): Promise<string> {
  const runId = `prd-${parentIssueNumber}`;
  const collected = await collectWorkerResults(cwd, await loadRunState(cwd, runId));

  if (collected.changed) {
    await saveRunState(cwd, collected.state);
    await Promise.all(collected.events.map((event) => appendRunEvent(cwd, runId, event)));
    return (
      collected.messages.join("\n\n") || [`run: ${runId}`, "decision: collected results"].join("\n")
    );
  }

  const starting = Object.values(collected.state.slices)
    .toSorted((a, b) => a.issueNumber - b.issueNumber)
    .find((slice) => slice.lifecycle === "starting" && slice.worker?.status === "starting");

  if (starting?.worker) {
    const files = getWorkerFiles(cwd, runId, starting.issueNumber);
    const spawned = spawnPiWorker({ worker: starting.worker, files, runId, mode: spawnMode, config });
    const nextState = markWorkerRunning({
      state: collected.state,
      issueNumber: starting.issueNumber,
      pid: spawned.pid,
      sessionFile: spawned.sessionFile,
    });

    await saveRunState(cwd, nextState);
    await appendRunEvent(cwd, runId, {
      type: "minion-spawned",
      at: new Date().toISOString(),
      issueNumber: starting.issueNumber,
      pid: spawned.pid,
      sessionFile: spawned.sessionFile,
    });

    return [`run: ${runId}`, `decision: spawned #${starting.issueNumber}`].join("\n");
  }

  return prepareNextWorker(cwd, repo, parentIssueNumber, collected.state, config);
}

async function collectWorkerResults(
  cwd: string,
  state: OrchestratorRunState,
): Promise<{
  state: OrchestratorRunState;
  changed: boolean;
  messages: string[];
  events: Record<string, unknown>[];
}> {
  let nextState = state;
  let changed = false;
  const messages: string[] = [];
  const events: Record<string, unknown>[] = [];

  for (const slice of Object.values(state.slices).filter(
    (candidate) => candidate.lifecycle === "implementing" && candidate.worker,
  )) {
    const worker = slice.worker;
    if (!worker) continue;

    if (!(await pathExists(worker.resultPath))) {
      if (worker.pid && isProcessAlive(worker.pid)) {
        messages.push(`run: ${state.runId}\ndecision: #${slice.issueNumber} still running`);
        continue;
      }

      nextState = failSliceWorker({
        state: nextState,
        issueNumber: slice.issueNumber,
        message: "Minion exited without done.json",
      });
      changed = true;
      events.push({
        type: "minion-dead",
        at: new Date().toISOString(),
        issueNumber: slice.issueNumber,
      });
      messages.push(`run: ${state.runId}\ndecision: #${slice.issueNumber} failed; no done.json`);
      continue;
    }

    try {
      const result = await readWorkerResult(worker.resultPath);
      nextState = completeSliceWorker({ state: nextState, issueNumber: slice.issueNumber, result });
      changed = true;
      events.push({
        type: `minion-${result.status}`,
        at: new Date().toISOString(),
        issueNumber: slice.issueNumber,
      });
      messages.push(`run: ${state.runId}\ndecision: #${slice.issueNumber} minion ${result.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nextState = failSliceWorker({
        state: nextState,
        issueNumber: slice.issueNumber,
        message: `Invalid done.json: ${message}`,
      });
      changed = true;
      events.push({
        type: "minion-result-invalid",
        at: new Date().toISOString(),
        issueNumber: slice.issueNumber,
        error: message,
      });
      messages.push(
        `run: ${state.runId}\ndecision: #${slice.issueNumber} failed; invalid done.json`,
      );
    }
  }

  return { state: nextState, changed, messages, events };
}

async function prepareNextWorker(
  cwd: string,
  repo: string,
  parentIssueNumber: number,
  currentState: OrchestratorRunState,
  config: OrchestratorConfig,
): Promise<string> {
  const runId = `prd-${parentIssueNumber}`;
  const state = refreshSliceReadiness(currentState);
  const activeCount = Object.values(state.slices).filter((slice) =>
    ["starting", "implementing"].includes(slice.lifecycle),
  ).length;

  if (activeCount >= config.maxParallel) return [`run: ${runId}`, "decision: max parallel reached"].join("\n");

  const nextIssueNumber = getReadySliceIssueNumbers(state)[0];
  if (!nextIssueNumber) return [`run: ${runId}`, "decision: no runnable issue"].join("\n");

  const { parent, slices } = await fetchParentAndSlices({
    cwd,
    repo,
    parentIssueNumber,
  });
  const slice = (slices.length ? slices : [parent]).find(
    (candidate) => candidate.number === nextIssueNumber,
  );

  if (!slice) throw new Error(`Could not find issue #${nextIssueNumber}`);

  const workerId = `issue-${nextIssueNumber}-${Date.now()}`;
  const branch = `orchestrator/prd-${parentIssueNumber}/issue-${nextIssueNumber}`;
  const baseRef = await getWorkerBaseRef(cwd, state, nextIssueNumber);
  const workerFiles = getWorkerFiles(cwd, runId, nextIssueNumber);
  const worktree = await createWorktrunkWorktree({
    cwd,
    branch,
    baseRef,
    worktrunkConfigPath: state.worktrunk.configPath,
    logPath: workerFiles.worktrunkLogPath,
  });
  const files = await writeWorkerPrompt({
    cwd,
    runId,
    issueNumber: nextIssueNumber,
    prompt: buildWorkerPrompt({
      state,
      parent,
      slice,
      resultPath: workerFiles.resultPath,
      checks: config.checks,
    }),
  });
  const nextState = startSliceWorker({
    state,
    issueNumber: nextIssueNumber,
    worker: {
      id: workerId,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
      worktrunkConfigPath: worktree.worktrunkConfigPath,
      resultPath: files.resultPath,
      promptPath: files.promptPath,
    },
  });

  await saveRunState(cwd, nextState);
  await appendRunEvent(cwd, runId, {
    type: "minion-prepared",
    at: new Date().toISOString(),
    issueNumber: nextIssueNumber,
    workerId,
    promptPath: files.promptPath,
    resultPath: files.resultPath,
    worktreePath: worktree.worktreePath,
    baseRef,
  });

  return [
    `run: ${runId}`,
    `decision: prepared #${nextIssueNumber}`,
    `base: ${baseRef}`,
    `worktree: ${worktree.worktreePath}`,
  ].join("\n");
}

async function integrateRun(
  cwd: string,
  parentIssueNumber: number,
  config: OrchestratorConfig,
): Promise<string> {
  const runId = `prd-${parentIssueNumber}`;
  const state = await loadRunState(cwd, runId);
  const ordered = topologicalSlices(state);
  const incomplete = ordered.filter((slice) => slice.lifecycle !== "complete");

  if (incomplete.length) {
    return [
      `run: ${runId}`,
      "decision: cannot integrate; issues incomplete",
      ...incomplete.map((slice) => `#${slice.issueNumber} ${slice.lifecycle}`),
    ].join("\n");
  }

  const trunkBranch = await getTrunkBranch(cwd);
  const integrationBranch = `orchestrator/${runId}/integration`;

  await runCommand("git", ["fetch", "origin"], { cwd });
  await runCommand(
    "git",
    ["switch", "--force-create", integrationBranch, `origin/${trunkBranch}`],
    { cwd },
  );

  const stackBranches: { issueNumber: number; branch: string; base: string; title: string }[] = [];
  let previousBase = trunkBranch;
  for (const slice of ordered) {
    const commits = slice.worker?.result?.status === "completed" ? slice.worker.result.commits : [];
    if (commits.length !== 1)
      throw new Error(`Slice #${slice.issueNumber} must have exactly one commit`);
    await runCommand("git", ["cherry-pick", commits[0] ?? ""], { cwd });

    if (config.publishMode === "stacked-prs") {
      const branch = `orchestrator/${runId}/issue-${slice.issueNumber}`;
      const target = (await runCommand("git", ["rev-parse", "HEAD"], { cwd })).trim();
      await forceUpdateBranch({ cwd, branch, target, worktreePath: slice.worker?.worktreePath });
      stackBranches.push({ issueNumber: slice.issueNumber, branch, base: previousBase, title: slice.title });
      previousBase = branch;
    }
  }

  if (config.publishMode === "none") {
    await appendRunEvent(cwd, runId, {
      type: "integrated",
      at: new Date().toISOString(),
      branch: integrationBranch,
    });
    return [`run: ${runId}`, "decision: integrated", `branch: ${integrationBranch}`].join("\n");
  }

  if (config.publishMode === "stacked-prs") {
    const prs = await ensureStackedPullRequests({ cwd, parentIssueNumber, state, branches: stackBranches });
    await appendRunEvent(cwd, runId, {
      type: "integrated",
      at: new Date().toISOString(),
      branch: integrationBranch,
      pullRequest: prs.map((pr) => pr.url).join(", "),
    });
    return [
      `run: ${runId}`,
      "decision: integrated as stacked PRs",
      `integration branch: ${integrationBranch}`,
      ...prs.map((pr) => `#${pr.issueNumber}: ${pr.url}`),
    ].join("\n");
  }

  await runCommand("git", ["push", "--force-with-lease", "-u", "origin", integrationBranch], {
    cwd,
  });

  const pr = await ensureFinalPullRequest({
    cwd,
    branch: integrationBranch,
    parentIssueNumber,
    state,
  });
  await appendRunEvent(cwd, runId, {
    type: "integrated",
    at: new Date().toISOString(),
    branch: integrationBranch,
    pullRequest: pr.url,
  });

  return [
    `run: ${runId}`,
    "decision: integrated",
    `branch: ${integrationBranch}`,
    `pr: ${pr.url}`,
  ].join("\n");
}

async function ensureStackedPullRequests(input: {
  cwd: string;
  parentIssueNumber: number;
  state: OrchestratorRunState;
  branches: { issueNumber: number; branch: string; base: string; title: string }[];
}): Promise<{ issueNumber: number; number: number; url: string }[]> {
  for (const branch of input.branches) {
    await runCommand("git", ["push", "--force-with-lease", "-u", "origin", branch.branch], {
      cwd: input.cwd,
    });
  }

  const prs: { issueNumber: number; number: number; url: string }[] = [];
  for (const branch of input.branches) {
    const existing = await findPullRequest(input.cwd, branch.branch);
    if (existing) {
      prs.push({ issueNumber: branch.issueNumber, ...existing });
      continue;
    }

    const body = [
      `Parent PRD: #${input.parentIssueNumber}`,
      "",
      `Closes #${branch.issueNumber}`,
      "",
      "Generated by /orchestrate in stacked PR mode.",
    ].join("\n");
    const url = (
      await runCommand(
        "gh",
        [
          "pr",
          "create",
          "--base",
          branch.base,
          "--head",
          branch.branch,
          "--title",
          toConventionalPrTitle(branch.title),
          "--body",
          body,
        ],
        { cwd: input.cwd },
      )
    ).trim();
    const created = await findPullRequest(input.cwd, branch.branch);
    if (created) {
      prs.push({ issueNumber: branch.issueNumber, ...created });
      continue;
    }

    const number = Number(url.match(/\/pull\/(\d+)$/)?.[1]);
    if (!Number.isSafeInteger(number)) throw new Error(`Could not parse created PR URL: ${url}`);
    prs.push({ issueNumber: branch.issueNumber, number, url });
  }

  await runCommand("stack", ["sync", "--apply"], { cwd: input.cwd });
  return prs;
}

async function ensureFinalPullRequest(input: {
  cwd: string;
  branch: string;
  parentIssueNumber: number;
  state: OrchestratorRunState;
}): Promise<{ number: number; url: string }> {
  const existing = await findPullRequest(input.cwd, input.branch);
  if (existing) return existing;

  const title = toConventionalPrTitle(input.state.parent.title);
  const closes = input.state.plan.sliceIssueNumbers.map(
    (issueNumber) => `- Closes #${issueNumber}`,
  );
  const body = [
    `Parent PRD: #${input.parentIssueNumber}`,
    "",
    "Implemented issues:",
    ...(closes.length ? closes : [`- Closes #${input.parentIssueNumber}`]),
    "",
    "Generated by /orchestrate.",
  ].join("\n");
  const url = (
    await runCommand(
      "gh",
      [
        "pr",
        "create",
        "--base",
        await getTrunkBranch(input.cwd),
        "--head",
        input.branch,
        "--title",
        title,
        "--body",
        body,
      ],
      { cwd: input.cwd },
    )
  ).trim();
  const created = await findPullRequest(input.cwd, input.branch);
  if (created) return created;

  const number = Number(url.match(/\/pull\/(\d+)$/)?.[1]);
  if (!Number.isSafeInteger(number)) throw new Error(`Could not parse created PR URL: ${url}`);

  return { number, url };
}

async function getWorkerBaseRef(
  cwd: string,
  state: OrchestratorRunState,
  issueNumber: number,
): Promise<string> {
  const ordered = topologicalSlices(state);
  const index = ordered.findIndex((slice) => slice.issueNumber === issueNumber);

  if (index < 0) throw new Error(`Unknown issue #${issueNumber}`);

  const slice = ordered[index];
  if (!slice.dependencies.length) return `origin/${await getTrunkBranch(cwd)}`;

  const dependencyBranches = slice.dependencies
    .map((dependency) => state.slices[String(dependency)]?.worker?.branch)
    .filter((branch): branch is string => Boolean(branch));
  const previousBranch = dependencyBranches.at(-1);
  if (!previousBranch) throw new Error(`Dependencies for #${issueNumber} have no branch`);

  return previousBranch;
}

function getRunStatus(state: OrchestratorRunState): "running" | "complete" | "failed" {
  const slices = Object.values(state.slices);

  if (slices.some((slice) => slice.lifecycle === "blocked" || slice.lifecycle === "failed")) {
    return "failed";
  }

  if (slices.length > 0 && slices.every((slice) => slice.lifecycle === "complete"))
    return "complete";

  return "running";
}

function topologicalSlices(state: OrchestratorRunState) {
  const slices = Object.values(state.slices).toSorted((a, b) => a.issueNumber - b.issueNumber);
  const remaining = new Map(slices.map((slice) => [slice.issueNumber, slice]));
  const ordered = [];

  while (remaining.size) {
    const ready = [...remaining.values()].find((slice) =>
      slice.dependencies.every((dependency) => !remaining.has(dependency)),
    );

    if (!ready) throw new Error("Issue dependencies contain a cycle");

    ordered.push(ready);
    remaining.delete(ready.issueNumber);
  }

  return ordered;
}

function createProgress(ui: CommandContext["ui"], runId: string) {
  const theme = ui.theme;
  const color = (name: string, text: string) => theme?.fg(name, text) ?? text;
  const bold = (text: string) => theme?.bold(text) ?? text;

  return {
    update: (progress: Progress) => {
      const status = progress.iteration
        ? `orchestrator ${runId} #${progress.iteration} ${progress.phase}`
        : `orchestrator ${runId} ${progress.phase}`;

      ui.setStatus?.("orchestrator", `${color("accent", "●")} ${color("dim", status)}`);

      const field = (label: string, value: string, valueColor = "text") =>
        `${color("muted", `${label}:`)} ${color(valueColor, value)}`;

      const lines = [
        `${color("accent", bold("Orchestrator"))} ${color("dim", runId)}`,
        progress.iteration ? field("iteration", String(progress.iteration)) : undefined,
        field("phase", progress.phase, "accent"),
        progress.state ? field("issues", countLifecycles(progress.state)) : undefined,
        progress.last ? field("last", progress.last) : undefined,
      ].filter((line): line is string => Boolean(line));

      ui.setWidget?.("orchestrator-progress", lines, { placement: "aboveEditor" });
    },
    clear: () => {
      ui.setStatus?.("orchestrator", undefined);
      ui.setWidget?.("orchestrator-progress", undefined);
    },
  };
}

type Progress = {
  phase: string;
  runId: string;
  iteration?: number;
  state?: OrchestratorRunState;
  last?: string;
};

function formatRunStatus(state: OrchestratorRunState): string {
  const slices = Object.values(state.slices).toSorted((a, b) => a.issueNumber - b.issueNumber);
  const ready = getReadySliceIssueNumbers(refreshSliceReadiness(state));

  return [
    `run: ${state.runId}`,
    `parent: #${state.parent.issueNumber} ${state.parent.title}`,
    `issues: ${state.plan.sliceIssueNumbers.length}`,
    `ready: ${formatIssueList(ready)}`,
    "",
    ...slices.map((slice) => {
      const deps = slice.dependencies.length ? ` deps: ${formatIssueList(slice.dependencies)}` : "";
      const worker = slice.worker ? ` worker: ${slice.worker.status}` : "";
      return `#${slice.issueNumber} ${slice.lifecycle}${deps}${worker} - ${slice.title}`;
    }),
  ].join("\n");
}

function toConventionalPrTitle(title: string): string {
  const subject = title
    .replace(/^PRD:\s*/i, "")
    .replace(/^Implement\s+/i, "")
    .trim()
    .replace(/^./, (character) => character.toLowerCase());

  return /^(feat|fix|test|refactor|chore|docs)(\(.+\))?:\s+.+/i.test(subject)
    ? subject
    : `feat: ${subject}`;
}

function parseArgs(args: string): {
  issue: string | undefined;
  mode: PiWorkerSpawnMode;
  publishMode?: OrchestratorPublishMode;
} {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const headed = parts.includes("--headed");
  const publishMode = parts.includes("--stack")
    ? "stacked-prs"
    : parts.includes("--no-pr")
      ? "none"
      : undefined;
  const flags = new Set(["--headed", "--stack", "--no-pr"]);

  return {
    issue: parts.find((part) => !flags.has(part)),
    mode: headed ? "headed" : "background",
    ...(publishMode ? { publishMode } : {}),
  };
}

export function parseIssueNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const issueNumber = Number(value.match(/(?:issues\/|#)?(\d+)(?:\D*)$/)?.[1] ?? value);

  return Number.isSafeInteger(issueNumber) ? issueNumber : undefined;
}

function countLifecycles(state: OrchestratorRunState): string {
  const counts = Object.values(state.slices).reduce<Record<string, number>>((acc, slice) => {
    acc[slice.lifecycle] = (acc[slice.lifecycle] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([lifecycle, count]) => `${lifecycle} ${count}`)
    .join(" • ");
}

function summarize(result: string): string {
  return (
    result
      .split("\n")
      .find((line) => line.startsWith("decision:"))
      ?.replace(/^decision:\s*/, "") ??
    result.split("\n")[0] ??
    ""
  );
}

function formatIssueList(issueNumbers: number[]): string {
  return issueNumbers.length
    ? issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ")
    : "none";
}

async function getTrunkBranch(cwd: string): Promise<string> {
  try {
    const stdout = await runCommand("git", ["remote", "show", "origin"], { cwd });
    return stdout.match(/HEAD branch:\s*(\S+)/)?.[1] ?? "main";
  } catch {
    return "main";
  }
}

async function findPullRequest(
  cwd: string,
  branch: string,
): Promise<{ number: number; url: string } | undefined> {
  try {
    const stdout = await runCommand("gh", ["pr", "view", branch, "--json", "number,url"], { cwd });
    return JSON.parse(stdout) as { number: number; url: string };
  } catch {
    return undefined;
  }
}

async function forceUpdateBranch(input: {
  cwd: string;
  branch: string;
  target: string;
  worktreePath?: string;
}): Promise<void> {
  if (!input.worktreePath) {
    await runCommand("git", ["branch", "--force", input.branch, input.target], { cwd: input.cwd });
    return;
  }

  const currentBranch = (await runCommand("git", ["branch", "--show-current"], { cwd: input.worktreePath })).trim();
  if (currentBranch !== input.branch) {
    await runCommand("git", ["branch", "--force", input.branch, input.target], { cwd: input.cwd });
    return;
  }

  const status = await runCommand("git", ["status", "--porcelain"], { cwd: input.worktreePath });
  if (status.trim()) {
    throw new Error(`Cannot update checked-out branch ${input.branch}; worktree has uncommitted changes: ${input.worktreePath}`);
  }

  await runCommand("git", ["reset", "--hard", input.target], { cwd: input.worktreePath });
  await runCommand("git", ["clean", "-fd"], { cwd: input.worktreePath });
}

function runCommand(command: string, args: string[], options: { cwd: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      resolve(stdout);
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
