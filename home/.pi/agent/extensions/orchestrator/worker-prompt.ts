import type { OrchestratorCheck } from "./config";
import type { OrchestratorRunState, IssueInput } from "./state";

export function buildWorkerPrompt(input: {
  state: OrchestratorRunState;
  parent: IssueInput;
  slice: IssueInput;
  resultPath: string;
  checks: OrchestratorCheck[];
}): string {
  const completedDependencies = input.state.slices[String(input.slice.number)]?.dependencies ?? [];

  return [
    `You are implementing one Orchestrator PRD slice in Pi print mode.`,
    ``,
    `## Parent PRD`,
    `#${input.parent.number}: ${input.parent.title}`,
    input.parent.url,
    ``,
    input.parent.body,
    ``,
    `## Slice`,
    `#${input.slice.number}: ${input.slice.title}`,
    input.slice.url,
    ``,
    input.slice.body,
    ``,
    `## Completed dependencies`,
    completedDependencies.length
      ? completedDependencies.map((issueNumber) => `- #${issueNumber}`).join("\n")
      : `None`,
    ``,
    `## Instructions`,
    `- Implement only this slice.`,
    `- Use existing project instructions and commands from AGENTS.md.`,
    `- Do not implement later dependent slices unless required to make this slice coherent.`,
    `- Run focused checks, then broader checks when appropriate.`,
    `- Required repo checks:`,
    input.checks.length
      ? input.checks
          .filter((check) => check.required)
          .map((check) => `  - ${check.name}: \`${check.command}\``)
          .join("\n") || `  - None configured`
      : `  - None configured`,
    `- Optional repo checks:`,
    input.checks.length
      ? input.checks
          .filter((check) => !check.required)
          .map((check) => `  - ${check.name}: \`${check.command}\``)
          .join("\n") || `  - None configured`
      : `  - None configured`,
    `- Do not write done.json until checks pass.`,
    `- End with exactly one commit for this slice. Squash/fixup/amend before writing done.json.`,
    `- Use Conventional Commits for the commit title and any PR title you suggest: \`type(scope): imperative summary\`.`,
    `- Preferred types: feat, fix, test, refactor, chore, docs. Use a scope when helpful, e.g. \`feat(league): add welcome message\`.`,
    `- Keep the first line lowercase after the type/scope, concise, and PR-ready. The commit body becomes PR body context.`,
    `- Include \`Closes #${input.slice.number}\` in the commit body so GitHub links/closes the slice issue.`,
    `- Write exactly that one commit SHA in result.commits.`,
    `- Write the worker done JSON to: ${input.resultPath}`,
    ``,
    `## Done JSON contract`,
    `On success:`,
    "```json",
    JSON.stringify(
      {
        status: "completed",
        summary: "What changed",
        changedFiles: ["path/to/file.ts"],
        commits: ["git-sha"],
        checks: input.checks.map((check) => ({
          name: check.name,
          status: "passed",
          command: check.command,
        })),
      },
      null,
      2,
    ),
    "```",
    ``,
    `If blocked:`,
    "```json",
    JSON.stringify({ status: "blocked", reason: "Why blocked", needsHuman: false }, null, 2),
    "```",
    ``,
    `If failed:`,
    "```json",
    JSON.stringify({ status: "failed", error: "What failed" }, null, 2),
    "```",
  ].join("\n");
}
