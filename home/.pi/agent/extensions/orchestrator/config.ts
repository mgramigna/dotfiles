import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type OrchestratorCheck = {
  name: string;
  command: string;
  required: boolean;
};

export type OrchestratorThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type OrchestratorPublishMode = "single-pr" | "stacked-prs" | "none";

export type OrchestratorConfig = {
  maxParallel: number;
  checks: OrchestratorCheck[];
  publishMode: OrchestratorPublishMode;
  model?: string;
  thinking?: OrchestratorThinkingLevel;
};

export const defaultOrchestratorConfig: OrchestratorConfig = {
  maxParallel: 2,
  checks: [],
  publishMode: "single-pr",
};

export function getConfigPath(cwd: string): string {
  return join(cwd, ".pi", "orchestrator.json");
}

export function getGlobalConfigPath(): string {
  return join(getAgentDir(), "orchestrator.json");
}

type PartialOrchestratorConfig = Partial<OrchestratorConfig>;

export async function loadOrchestratorConfig(input: {
  cwd: string;
  trusted: boolean;
}): Promise<OrchestratorConfig> {
  const globalConfig = await loadOptionalConfig(getGlobalConfigPath());
  const projectConfig = input.trusted ? await loadOptionalConfig(getConfigPath(input.cwd)) : undefined;
  return { ...defaultOrchestratorConfig, ...globalConfig, ...projectConfig };
}

export async function loadOptionalConfig(path: string): Promise<PartialOrchestratorConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  return parsePartialOrchestratorConfig(JSON.parse(raw));
}

export function parseOrchestratorConfig(value: unknown): OrchestratorConfig {
  return { ...defaultOrchestratorConfig, ...parsePartialOrchestratorConfig(value) };
}

function parsePartialOrchestratorConfig(value: unknown): PartialOrchestratorConfig {
  if (!isRecord(value)) throw new Error("orchestrator config must be an object");

  let maxParallel: number | undefined;
  if (value.maxParallel !== undefined) {
    if (typeof value.maxParallel !== "number" || !Number.isSafeInteger(value.maxParallel) || value.maxParallel < 1) {
      throw new Error("orchestrator config maxParallel must be a positive integer");
    }
    maxParallel = value.maxParallel;
  }

  let checks: OrchestratorCheck[] | undefined;
  if (value.checks !== undefined) {
    if (!Array.isArray(value.checks)) throw new Error("orchestrator config checks must be an array");
    checks = value.checks.map((check, index): OrchestratorCheck => {
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
  }

  const model = parseOptionalString(value.model, "model");
  const thinking = parseOptionalThinkingLevel(value.thinking);
  const publishMode = parseOptionalPublishMode(value.publishMode);
  return {
    ...(maxParallel !== undefined ? { maxParallel } : {}),
    ...(checks !== undefined ? { checks } : {}),
    ...(publishMode !== undefined ? { publishMode } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
  };
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

function parseOptionalPublishMode(value: unknown): OrchestratorPublishMode | undefined {
  if (value === undefined) return undefined;
  const allowed = ["single-pr", "stacked-prs", "none"] as const;
  if (typeof value !== "string" || !allowed.includes(value as OrchestratorPublishMode)) {
    throw new Error(`orchestrator config publishMode must be one of: ${allowed.join(", ")}`);
  }
  return value as OrchestratorPublishMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
