import { execFile } from "node:child_process";

import type { IssueInput } from "./state";

type GhIssue = {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  url: string;
};

export async function detectGitHubRepo(cwd: string): Promise<string> {
  try {
    return (await runCommand("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd)).trim();
  } catch {
    const remote = (await runCommand("git", ["remote", "get-url", "origin"], cwd)).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);

    if (!match?.[1]) throw new Error(`Could not detect GitHub repo from origin: ${remote}`);

    return match[1];
  }
}

export async function fetchParentAndSlices(input: {
  cwd: string;
  repo: string;
  parentIssueNumber: number;
}): Promise<{ parent: IssueInput; slices: IssueInput[] }> {
  const parent = await fetchIssue(input.cwd, input.repo, input.parentIssueNumber);
  const candidates = await searchIssues(input.cwd, input.repo, input.parentIssueNumber);
  const slices = candidates
    .filter((issue) => issue.number !== input.parentIssueNumber)
    .filter((issue) => hasParentPrd(issue.body, input.parentIssueNumber))
    .toSorted((a, b) => a.number - b.number);

  return { parent, slices };
}

async function fetchIssue(cwd: string, repo: string, issueNumber: number): Promise<IssueInput> {
  const stdout = await runGh(
    [
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      repo,
      "--json",
      "number,title,body,state,url",
    ],
    cwd,
  );

  return toIssueInput(JSON.parse(stdout) as GhIssue);
}

async function searchIssues(
  cwd: string,
  repo: string,
  parentIssueNumber: number,
): Promise<IssueInput[]> {
  const stdout = await runGh(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--search",
      String(parentIssueNumber),
      "--json",
      "number,title,body,state,url",
      "--limit",
      "100",
    ],
    cwd,
  );

  return (JSON.parse(stdout) as GhIssue[]).map(toIssueInput);
}

function runGh(args: string[], cwd: string): Promise<string> {
  return runCommand("gh", args, cwd);
}

function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      resolve(stdout);
    });
  });
}

function hasParentPrd(body: string, parentIssueNumber: number): boolean {
  return new RegExp(`##\\s+Parent PRD[\\s\\S]*#${parentIssueNumber}(?!\\d)`, "i").test(body);
}

function toIssueInput(issue: GhIssue): IssueInput {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    url: issue.url,
  };
}
