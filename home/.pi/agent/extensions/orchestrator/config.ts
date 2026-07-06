import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OrchestratorCheck = {
  name: string;
  command: string;
  required: boolean;
};

export type OrchestratorThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type OrchestratorConfig = {
  maxParallel: number;
  checks: OrchestratorCheck[];
  model?: string;
  thinking?: OrchestratorThinkingLevel;
};

export const defaultOrchestratorConfig: OrchestratorConfig = {
  maxParallel: 2,
  checks: [],
};

export function getConfigPath(cwd: string): string {
  return join(cwd, ".pi", "orchestrator.json");
}

export async function loadOrchestratorConfig(input: {
  cwd: string;
  trusted: boolean;
}): Promise<OrchestratorConfig> {
  if (!input.trusted) return defaultOrchestratorConfig;

  let raw: string;
  try {
    raw = await readFile(getConfigPath(input.cwd), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultOrchestratorConfig;
    throw error;
  }

  return parseOrchestratorConfig(JSON.parse(raw));
}

export function parseOrchestratorConfig(value: unknown): OrchestratorConfig {
  if (!isRecord(value)) throw new Error("orchestrator config must be an object");

  const maxParallelValue = value.maxParallel ?? defaultOrchestratorConfig.maxParallel;
  if (typeof maxParallelValue !== "number" || !Number.isSafeInteger(maxParallelValue) || maxParallelValue < 1) {
    throw new Error("orchestrator config maxParallel must be a positive integer");
  }

  const checksValue = value.checks ?? defaultOrchestratorConfig.checks;
  if (!Array.isArray(checksValue)) throw new Error("orchestrator config checks must be an array");

  const model = parseOptionalString(value.model, "model");
  const thinking = parseOptionalThinkingLevel(value.thinking);

  const checks = checksValue.map((check, index): OrchestratorCheck => {
    if (!isRecord(check)) throw new Error(`orchestrator config checks[${index}] must be an object`);
    if (typeof check.name !== "string" || !check.name.trim()) {
      throw new Error(`orchestrator config checks[${index}].name must be a string`);
    }
    if (typeof check.command !== "string" || !check.command.trim()) {
      throw new Error(`orchestrator config checks[${index}].command must be a string`);
    }
    if (typeof check.required !== "boolean") {
      throw new Error(`orchestrator config checks[${index}].required must be a boolean`);
    }

    return {
      name: check.name,
      command: check.command,
      required: check.required,
    };
  });

  return { maxParallel: maxParallelValue, checks, model, thinking };
}

function parseOptionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`orchestrator config ${key} must be a non-empty string`);
  }
  return value;
}

function parseOptionalThinkingLevel(value: unknown): OrchestratorThinkingLevel | undefined {
  if (value === undefined) return undefined;
  const allowed = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
  if (typeof value !== "string" || !allowed.includes(value as OrchestratorThinkingLevel)) {
    throw new Error(`orchestrator config thinking must be one of: ${allowed.join(", ")}`);
  }
  return value as OrchestratorThinkingLevel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
