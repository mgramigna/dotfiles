# Council review

The council is a user-requested adversarial review by at least two different models. Members investigate independently, exchange evidence and objections, then explicitly vote on each finding. Only unanimously accepted findings appear in the result.

It focuses on practical correctness, security, authorization, data loss and supported workflow regressions. It excludes style nits and speculative defensive engineering. Rare but credible serious security or data-loss failures still qualify.

## Request a review

After linking the dotfiles, restart Pi or run `/reload` to load `home/.pi/agent/extensions/council/index.ts`.

```text
/council
/council review current uncommitted changes, focusing on tenant isolation
/council review commit abc123 for rollback risks
/council review local branch feature/scheduling against main
/council review PR 123
/council review https://github.com/owner/repo/pull/123
/council compare release/v2 with release/v3, focusing on migrations
/council config
/council status
/council summary
/council summary review-cDBG4a
/council summary /path/to/council/runs/review-cDBG4a
/council hide
/council cancel
```

`/council <request>` accepts plain language. The optional `review` prefix is just a convenience. With no request, it defaults to current uncommitted changes, including staged, unstaged and untracked files. An empty working tree does not implicitly mean "review the last commit."

The extension passes the same request to both reviewers. It does not generate, attach or limit a diff. Each reviewer resolves the target and uses read-only Git or GitHub CLI inspection as appropriate:

- Uncommitted changes: inspect the staged and unstaged diffs separately, plus relevant untracked files.
- Specific commit: resolve its SHA and review that commit's change, without including unrelated working-tree changes.
- Local branch: resolve its tip and intended base, then inspect changes from their merge-base, even if another branch is checked out.
- PR: resolve its repository, base and head revisions with `gh`, then inspect the diff and source at those revisions. URLs can refer to another repository.

Other requests, such as a commit range or selected files, work the same way. Be explicit about the comparison base when it matters. There is no special `base` command parser; describe the comparison you want in the request.

Reviewers record their inspected scope and resolved revisions in their submissions. Those scopes appear in the result and full discussion. Missing access or an ambiguous target makes the review incomplete rather than silently substituting the current diff. PR review requires a working, authenticated `gh` installation.

In the TUI and RPC modes, the command starts a background review and returns immediately. You can keep chatting with the main agent or start a review while it is working. The reviewers have separate conversations, so your ongoing chat does not steer them. Editing the code they are inspecting can still make their evidence inconsistent. Print and JSON batch modes wait for the result before exiting.

The TUI shows a live panel above the editor with the review phase, elapsed time, each member's model, working/submitted state, inspection activity, tool count, turns, tokens and reported cost. Discussion rounds show the pending candidate count, but never draft findings, model reasoning, raw shell commands or ballot arguments. The panel does not take keyboard focus.

Use `/council hide` to reclaim space without stopping the review and `/council status` to restore it. `/council cancel` stops the review without interrupting your chat. The final report appears as a compact, expandable transcript entry. Press Ctrl+O to show the full findings, scopes and limitations. Reports do not request a new main-agent turn or steer the current response. Starting a new session, reloading Pi, or navigating to another session-tree branch cancels an in-flight council so its result is not posted into a different conversation.

No council review tool is exposed to models, no natural-language mention starts a review, and no event starts one automatically. The `council_submit` tool exists only inside child reviewer sessions to record findings and ballots; it cannot start a review.

## Summarize a discussion

`/council summary` asks the current session's agent to explain the latest completed council review in this conversation. It reads the saved discussion journal and final report, then summarizes what was accepted, rejected or left unresolved, who disagreed, and what evidence changed a reviewer's position. Straightforward unanimous findings stay brief. Rejected candidates are labeled as discussion history, not extra confirmed findings.

This is opt-in. Finishing a review does not automatically generate a summary, invoke another council or make an extra model call. The summary uses your current agent and model, with the unslop writing skill when available. If the agent is already responding, the summary request queues behind that response rather than steering it. It is a historical debrief, not a fresh code review.

After `/reload` or resuming a session, the command can recover the latest run from council result entries on the current session branch. To summarize another saved review, pass its directory or `review-...` ID. No-argument summaries do not scan other sessions' reviews. If a council is still running, wait for it to finish or explicitly select an earlier run. Incomplete runs can be summarized, but the agent is instructed to explain their limitations rather than imply consensus.

## Configure members

Defaults match `home/.pi/agent/council.example.json`. To change them, copy that example to `~/.pi/agent/council.json`, or the equivalent under `PI_CODING_AGENT_DIR`. `/council config` shows the resolved settings and path.

```json
{
  "members": [
    { "name": "codex", "model": "openai-codex/gpt-6.1-sol", "thinking": "high" },
    { "name": "opus", "model": "anthropic/claude-opus-5-5", "thinking": "high" }
  ],
  "maxDebateRounds": 3,
  "timeoutMinutes": 20
}
```

Use exact provider/model IDs available through your Pi installation and credentials. Check `/model` and `/login` first. Members use the normal Pi model/auth runtime, including `models.json`; providers registered only by another extension are not loaded into child sessions. Missing models or authentication fail the review with no silent fallback.

There must be 2 to 8 uniquely named members with distinct provider/model IDs. Different aliases can still point to the same underlying model, so choose genuinely different models yourself. Each member defaults to high thinking, clamped by Pi to what the model supports. The debate limit is 1 to 6 rounds. The overall timeout is 1 to 120 minutes. Independent reviews happen before the debate rounds.

Configuration is global only. Repository-local settings cannot silently change who receives the code.

## Discussion and reporting

1. Check model availability and pass the same user request to each member.
2. Resolve and inspect the requested target independently, without the implementation conversation or peer findings.
3. Give every member the same pending claims. Each member submits accept, reject or insufficient-evidence ballots with reasons.
4. Exchange those responses for further investigation and rebuttal. An author can narrow or correct their own pending claim before the last round. A revision invalidates all votes on the old claim.
5. Stop when all candidates are resolved or the round limit is reached. Report only unanimously accepted claims, in severity order.

Unanimously rejected claims disappear. Disagreements remain unresolved and are counted without printing their details as findings. The full discussion remains available locally. Similar claims are not automatically merged, so duplicate accepted findings are possible.

A timeout, cancellation, missing submission, unavailable model or a reviewer reporting an inaccessible target produces an **incomplete review**, not an empty successful review. A successful result with no accepted findings is not a guarantee that the change is correct. Each member's reviewed scope and inspection limitations are shown separately. The coordinator does not independently verify that a model chose the correct revisions; members are prompted to establish those revisions and reconcile differences during discussion.

## Inspection and privacy

Reviewers get `read`, `bash`, `grep`, `find` and `ls`, plus the internal submission tool. Their system prompt prohibits modifications, tests, builds, linters, dependency installation and delegation. Bash is deliberately unrestricted at the tool level. This is a behavioral restriction, not a sandbox.

Trusted repository context files are loaded, but child sessions do not load other extensions, skills or prompt templates. Reviewers can inspect source, callers, tests and local reference repositories with their inspection tools.

There is no frozen diff or automatic checkout-change detection. Reviewers are prompted to resolve immutable commit IDs, inspect source at those revisions instead of assuming the working tree matches, and check mutable targets as needed. They must not checkout branches, fetch, create worktrees or otherwise mutate the repository. Avoid editing uncommitted changes or moving target refs during a review.

There is no extension-level snapshot size limit; reviewers retrieve the evidence they need through normal tool calls and model context limits. Code and inspected evidence are sent to every configured provider. The user request, finalized session transcripts, inspected scopes, ballots, usage and reports are saved under:

```text
~/.pi/agent/council/runs/review-*/
```

Run directories and files use private permissions. They can contain source code and tool output. There is no automatic retention cleanup; delete old run directories when no longer needed. Read-only inspection does not prevent a model from reading sensitive files, so only request a council review when sharing the repository with its configured providers is appropriate.

## Verify the extension

```bash
cd home/.pi/agent
npm run typecheck
node --experimental-strip-types --test tests/council.test.mjs
```

The integration tests run real SDK sessions against a local OpenAI-compatible test endpoint. They do not call paid models.
