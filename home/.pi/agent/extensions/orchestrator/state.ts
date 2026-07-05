export type IssueState = "OPEN" | "CLOSED";

export type IssueInput = {
  number: number;
  title: string;
  body: string;
  state: IssueState;
  url: string;
};

export type SliceLifecycle =
  | "pending"
  | "ready"
  | "starting"
  | "implementing"
  | "complete"
  | "blocked"
  | "failed";

export type WorkerStatus = "starting" | "running" | "completed" | "failed";

export type CheckStatus = "passed" | "failed" | "skipped";

export type CheckResult = {
  name: string;
  status: CheckStatus;
  command?: string;
  outputPath?: string;
  completedAt?: string;
};

export type WorkerResult =
  | {
      status: "completed";
      summary: string;
      changedFiles: string[];
      commits: string[];
      checks: CheckResult[];
    }
  | {
      status: "blocked";
      reason: string;
      needsHuman: boolean;
    }
  | {
      status: "failed";
      error: string;
    };

export type WorkerState = {
  id: string;
  kind: "pi-print";
  issueNumber: number;
  worktreePath: string;
  branch: string;
  worktrunkConfigPath: string;
  resultPath: string;
  promptPath: string;
  pid?: number;
  sessionFile?: string;
  status: WorkerStatus;
  startedAt: string;
  lastHeartbeatAt?: string;
  completedAt?: string;
  result?: WorkerResult;
  error?: {
    message: string;
    at: string;
  };
};

export type OrchestratorSliceState = {
  issueNumber: number;
  url: string;
  title: string;
  state: IssueState;
  bodyHash: string;
  dependencies: number[];
  lifecycle: SliceLifecycle;
  worker?: WorkerState;
  attempts: number;
};

export type OrchestratorRunState = {
  schemaVersion: 1;
  runId: string;
  parent: {
    issueNumber: number;
    url: string;
    title: string;
    state: IssueState;
    bodyHash: string;
  };
  plan: {
    parentIssueNumber: number;
    sliceIssueNumbers: number[];
  };
  worktrunk: {
    configPath: string;
  };
  slices: Record<string, OrchestratorSliceState>;
};

export function createInitialRunState(input: {
  runId: string;
  parent: IssueInput;
  slices: IssueInput[];
  worktrunkConfigPath?: string;
}): OrchestratorRunState {
  const executableIssues = input.slices.length ? input.slices : [input.parent];
  const sliceStates = Object.fromEntries(
    executableIssues
      .toSorted((a, b) => a.number - b.number)
      .map((slice) => {
        const dependencies = parseOrchestratorDependencies(slice.body);
        return [
          String(slice.number),
          {
            issueNumber: slice.number,
            url: slice.url,
            title: slice.title,
            state: slice.state,
            bodyHash: hashText(slice.body),
            dependencies,
            lifecycle: dependencies.length === 0 ? "ready" : "pending",
            attempts: 0,
          } satisfies OrchestratorSliceState,
        ];
      }),
  );

  const sliceIssueNumbers = Object.values(sliceStates).map((slice) => slice.issueNumber);

  return {
    schemaVersion: 1,
    runId: input.runId,
    parent: {
      issueNumber: input.parent.number,
      url: input.parent.url,
      title: input.parent.title,
      state: input.parent.state,
      bodyHash: hashText(input.parent.body),
    },
    plan: {
      parentIssueNumber: input.parent.number,
      sliceIssueNumbers,
    },
    worktrunk: {
      configPath: input.worktrunkConfigPath ?? ".config/wt.toml",
    },
    slices: sliceStates,
  };
}

export function getReadySliceIssueNumbers(state: OrchestratorRunState): number[] {
  return Object.values(state.slices)
    .filter((slice) => slice.lifecycle === "ready")
    .map((slice) => slice.issueNumber)
    .toSorted((a, b) => a - b);
}

export function refreshSliceReadiness(state: OrchestratorRunState): OrchestratorRunState {
  return updateSlices(state, (slice) => {
    if (slice.lifecycle !== "pending" && slice.lifecycle !== "ready") return slice;

    const dependenciesComplete = slice.dependencies.every(
      (dependency) => state.slices[String(dependency)]?.lifecycle === "complete",
    );

    return {
      ...slice,
      lifecycle: dependenciesComplete ? "ready" : "pending",
    };
  });
}

export function startSliceWorker(input: {
  state: OrchestratorRunState;
  issueNumber: number;
  worker: Omit<WorkerState, "issueNumber" | "kind" | "status" | "startedAt"> & {
    startedAt?: string;
  };
}): OrchestratorRunState {
  const slice = requireSlice(input.state, input.issueNumber);

  if (slice.lifecycle !== "ready") {
    throw new Error(`Slice #${input.issueNumber} is ${slice.lifecycle}, not ready`);
  }

  const worker: WorkerState = {
    ...input.worker,
    kind: "pi-print",
    issueNumber: input.issueNumber,
    status: "starting",
    startedAt: input.worker.startedAt ?? new Date().toISOString(),
  };

  return setSlice(input.state, input.issueNumber, {
    ...slice,
    lifecycle: "starting",
    worker,
    attempts: slice.attempts + 1,
  });
}

export function markWorkerRunning(input: {
  state: OrchestratorRunState;
  issueNumber: number;
  pid?: number;
  sessionFile?: string;
  at?: string;
}): OrchestratorRunState {
  const slice = requireSlice(input.state, input.issueNumber);
  const worker = requireWorker(slice);
  const at = input.at ?? new Date().toISOString();

  return setSlice(input.state, input.issueNumber, {
    ...slice,
    lifecycle: "implementing",
    worker: {
      ...worker,
      pid: input.pid ?? worker.pid,
      sessionFile: input.sessionFile ?? worker.sessionFile,
      status: "running",
      lastHeartbeatAt: at,
    },
  });
}

export function completeSliceWorker(input: {
  state: OrchestratorRunState;
  issueNumber: number;
  result: WorkerResult;
  at?: string;
}): OrchestratorRunState {
  const slice = requireSlice(input.state, input.issueNumber);
  const worker = requireWorker(slice);
  const at = input.at ?? new Date().toISOString();
  const lifecycle = workerResultToLifecycle(input.result);

  return refreshSliceReadiness(
    setSlice(input.state, input.issueNumber, {
      ...slice,
      lifecycle,
      worker: {
        ...worker,
        status: input.result.status === "completed" ? "completed" : "failed",
        completedAt: at,
        result: input.result,
      },
    }),
  );
}

export function failSliceWorker(input: {
  state: OrchestratorRunState;
  issueNumber: number;
  message: string;
  at?: string;
}): OrchestratorRunState {
  const slice = requireSlice(input.state, input.issueNumber);
  const worker = requireWorker(slice);
  const at = input.at ?? new Date().toISOString();

  return setSlice(input.state, input.issueNumber, {
    ...slice,
    lifecycle: "failed",
    worker: {
      ...worker,
      status: "failed",
      completedAt: at,
      error: {
        message: input.message,
        at,
      },
    },
  });
}

export function parseOrchestratorDependencies(body: string): number[] {
  const explicitBlock = body.match(
    /<!--\s*orchestrator-dependencies:start\s*-->([\s\S]*?)<!--\s*orchestrator-dependencies:end\s*-->/i,
  )?.[1];
  const blockedByBlock = body.match(/##\s*Blocked by\s*\n([\s\S]*?)(?=\n##\s|$)/i)?.[1];
  const block = [explicitBlock, blockedByBlock].filter(Boolean).join("\n");

  if (!block || /\bnone\b/i.test(block)) return [];

  return [...new Set([...block.matchAll(/#(\d+)/g)].map((match) => Number(match[1])))]
    .filter(Number.isSafeInteger)
    .toSorted((a, b) => a - b);
}

export function hashText(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function workerResultToLifecycle(result: WorkerResult): SliceLifecycle {
  if (result.status === "completed") return "complete";
  if (result.status === "blocked") return "blocked";
  return "failed";
}

function requireSlice(state: OrchestratorRunState, issueNumber: number): OrchestratorSliceState {
  const slice = state.slices[String(issueNumber)];

  if (!slice) throw new Error(`Unknown slice #${issueNumber}`);

  return slice;
}

function requireWorker(slice: OrchestratorSliceState): WorkerState {
  if (!slice.worker) throw new Error(`Slice #${slice.issueNumber} has no worker`);

  return slice.worker;
}

function setSlice(
  state: OrchestratorRunState,
  issueNumber: number,
  slice: OrchestratorSliceState,
): OrchestratorRunState {
  return {
    ...state,
    slices: {
      ...state.slices,
      [String(issueNumber)]: slice,
    },
  };
}

function updateSlices(
  state: OrchestratorRunState,
  update: (slice: OrchestratorSliceState) => OrchestratorSliceState,
): OrchestratorRunState {
  return {
    ...state,
    slices: Object.fromEntries(
      Object.entries(state.slices).map(([issueNumber, slice]) => [issueNumber, update(slice)]),
    ),
  };
}
