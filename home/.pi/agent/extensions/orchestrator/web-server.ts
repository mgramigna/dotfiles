import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { parseIssueNumber, runOrchestratorHeadless } from "./index";

const repoPath = process.env.ORCHESTRATOR_REPO ?? process.cwd();
const host = process.env.ORCHESTRATOR_HOST ?? "127.0.0.1";
const port = Number(process.env.ORCHESTRATOR_PORT ?? 8787);

let currentRun: {
  id: number;
  issueNumber: number;
  startedAt: string;
  status: "running" | "complete" | "failed";
  log: string[];
} | undefined;
let nextRunId = 1;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") return html(res);
    if (req.method === "GET" && url.pathname === "/api/issues") return json(res, await listPrdIssues());
    if (req.method === "GET" && url.pathname === "/api/status") return json(res, currentRun ?? null);
    if (req.method === "POST" && url.pathname === "/api/run") return startRun(req, res);

    res.writeHead(404).end("not found");
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`orchestrator web ui listening on http://${host}:${port}`);
  console.log(`repo: ${repoPath}`);
});

async function startRun(req: IncomingMessage, res: ServerResponse) {
  if (currentRun?.status === "running") return json(res, { error: "an orchestration run is already running" }, 409);

  const body = await readBody(req as any);
  const issueNumber = parseIssueNumber(String(body.issue ?? body.prompt ?? ""));
  if (!issueNumber) return json(res, { error: "Enter a GitHub issue URL, #number, or number." }, 400);

  currentRun = { id: nextRunId++, issueNumber, startedAt: new Date().toISOString(), status: "running", log: [] };
  const run = currentRun;
  run.log.push(`starting #${issueNumber} from ${repoPath}`);
  run.log.push("resetting main worktree to origin/default-branch before orchestration");

  void runOrchestratorHeadless({
    cwd: repoPath,
    parentIssueNumber: issueNumber,
    resetMainWorktree: true,
    freshRun: true,
    mode: "background",
    onProgress: (progress) => run.log.push(`${new Date().toISOString()} ${progress.runId} ${progress.phase}${progress.iteration ? ` #${progress.iteration}` : ""}`),
  }).then((result) => {
    run.status = "complete";
    run.log.push(result);
  }, (error) => {
    run.status = "failed";
    run.log.push(error instanceof Error ? error.stack ?? error.message : String(error));
  });

  return json(res, run, 202);
}

async function listPrdIssues() {
  const stdout = await execFileP("gh", [
    "issue", "list",
    "--search", "PRD in:title,body state:open",
    "--json", "number,title,url,updatedAt",
    "--limit", "50",
  ], repoPath);
  return JSON.parse(stdout);
}

function html(res: ServerResponse) {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<title>Orchestrator</title>
<style>body{font-family:system-ui;margin:2rem;max-width:900px}input,select,button{font:inherit;padding:.5rem}input{width:32rem}pre{background:#111;color:#eee;padding:1rem;white-space:pre-wrap}</style>
<h1>Orchestrator</h1>
<p>Repo: <code>${escapeHtml(repoPath)}</code></p>
<form id=f><select id=issues><option value="">Loading PRDs…</option></select><br><br><input id=issue placeholder="Issue URL, #123, or 123"><button>Start</button></form>
<h2>Status</h2><pre id=status>Loading…</pre>
<script>
async function refreshIssues(){try{const xs=await (await fetch('/api/issues')).json();issues.innerHTML='<option value="">Pick a PRD issue (optional)</option>'+xs.map(x=>'<option value="'+x.number+'">#'+x.number+' '+x.title.replaceAll('<','&lt;')+'</option>').join('')}catch(e){issues.innerHTML='<option value="">Could not load issues</option>'}}
issues.onchange=()=>{ if(issues.value) issue.value=issues.value }
f.onsubmit=async e=>{e.preventDefault(); const r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({issue:issue.value})}); status.textContent=JSON.stringify(await r.json(),null,2)}
async function poll(){try{status.textContent=JSON.stringify(await (await fetch('/api/status')).json(),null,2)}catch(e){status.textContent=String(e)} setTimeout(poll,3000)}
refreshIssues(); poll();
</script>`);
}

function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value, null, 2));
}

async function readBody(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function execFileP(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { cwd }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
}

function escapeHtml(value: string): string { return value.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c] ?? c)); }
