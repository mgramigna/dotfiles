# Pi reviewer

`/review` runs an independent verifier in the background. It checks intended behavior against source evidence rather than searching for a quota of bugs. `/review-adversarial` runs the original adversarial reviewer for a single invocation. `/review-kitchen-sink` runs both modes independently in parallel and produces two reports. All three accept free-form requests covering diffs, commits, branches, PRs, files, designs and ideas. The general subagent extension stays disabled; `agents/reviewer.md` is separate and unchanged.

## Commands

```text
/review
/review current diff, focusing on tenant isolation
/review commit abc123 for rollback regressions
/review PR https://github.com/example/project/pull/123
/review branch feature/scheduling against main
/review --context the caching proposal we discussed
/review --model openai-codex/gpt-6.1-sol --thinking xhigh current diff
/review-adversarial current diff
/review-adversarial --context challenge the caching proposal
/review-kitchen-sink current diff
/review-kitchen-sink --context the caching proposal we discussed
/review status
/review hide
/review cancel
/review help
```

With no request, it inspects staged, unstaged and untracked changes. `/review` always defaults to verification; using `/review-adversarial` does not change later invocations. All commands accept the same options and `status`, `hide`, `cancel` and `help` controls. They share one active task and its latest results. Kitchen-sink reviews use the same request, model, reasoning and invocation-time context, but separate isolated sessions, deadlines and artifacts. Neither sees the other's report. Cancelling stops both; one review failing does not stop the other.

The default model is the current session's model at invocation time, with `high` reasoning. Overrides apply only to that review, not the main session. An unavailable or unauthenticated model fails rather than silently falling back. Models that do not support the requested reasoning level use their supported level; the panel and report show the effective level.

Options must precede the request:

| Option | Meaning |
| --- | --- |
| `--model provider/model-id` | Override the reviewer model. |
| `--thinking level` | Override reasoning: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |
| `--context` | Attach recent user and assistant text for proposals or references to the conversation. |
| `--` | End option parsing. Also use it to review a request literally named `status`, `hide`, `cancel` or `help`. |

`--model=value` and `--thinking=value` also work. Tab completion covers options, available model IDs, reasoning levels, controls and common review targets. Once the free-form request starts, its text is left alone.

`--context` copies at most 24,000 characters of recent text from the current session branch, captured when invoked. It excludes tool results, thinking and images. Older material may be omitted. Without it, the reviewer receives the request and repository context, not the main agent's conversation or conclusions. For a long proposal, point it to a file instead.

## Background UI

The live panel shows the mode, target, model, reasoning, recent inspection tools, current activity, elapsed time, turns, token usage and cost. Keep chatting while it runs. `hide` hides the panel without cancelling; `status` restores it. Only one command invocation can run at a time. Kitchen-sink invocations show a progress panel for each reviewer and deliver each report as it finishes, waiting for the main agent to settle if needed.

The finished report is a collapsible conversation entry. Press `Ctrl+O` to expand it. If the main agent is still responding, the panel shows that the saved report is waiting. The extension appends it when the main agent settles. It never steers an ongoing response, requests another model turn or automatically applies fixes.

Changing session branches, switching sessions or reloading cancels running work and discards undelivered results, so a report cannot land on the wrong branch. Saved artifacts remain available. `/review status` shows the latest in-memory status until navigation or reload; persisted report entries remain in the session.

TUI and RPC commands return immediately. Print and JSON modes wait for the report. RPC exposes progress through `/review status`, not a terminal widget.

## Review behavior and limits

Verification identifies material behavioral claims from requirements, acceptance criteria, existing contracts and callers, then traces the relevant implementation. Each claim cites its requirement source and concrete evidence, and is marked `SUPPORTED`, `CONTRADICTED` or `UNRESOLVED`. Inferred requirements must be labeled as assumptions. Reading tests establishes what they assert, not that they pass.

Reports lead with these claims, followed by demonstrated defects and material inspection limitations. A defect needs a reachable situation, actual implementation behavior, a violated requirement or contract, and a meaningful consequence. Verification does not accept `HUNCH` or `QUESTION` findings. Missing evidence stays on the relevant unresolved claim. No defects is a successful outcome. Inspection stops once material claims are accounted for, without expanding the search merely to produce findings.

Complete coverage means the requested scope was inspected, not that every claim was supported. The collapsed report shows counts of supported, contradicted and unresolved claims. The assessment does not imply approval when claims are unresolved, contradicted or defects were found. Source support is not an execution result or proof of universal correctness.

`/review-adversarial` preserves the original approach: challenge assumptions, construct failure scenarios and try to disprove findings before reporting them. Its findings retain severity and `VERIFIED`, `HUNCH` or `QUESTION` confidence labels. Both modes include location, evidence, counterevidence checked, failure mode and a suggested fix for defects. Code locations use file references; design locations can cite sections or quoted claims.

Unavailable or partial scopes are marked incomplete, not clean. A model that stops without submitting a report also produces an incomplete review. Reviews have a 20-minute deadline, and individual bash inspection commands have a 30-second limit.

The isolated SDK session loads only inspection tools and its report-submission tool. It does not load extensions, skills, prompt templates or MCP servers. Trusted repository context files are available; untrusted project context is not loaded. Model configuration and credentials must be available to the isolated runtime; parent-only runtime providers may be unavailable.

Inspection is source-only. The prompt forbids writes, delegation, tests, typechecks, linters and builds. Bash still has normal operating-system permissions, so this is not a read-only sandbox. Likewise, command-only invocation removes model-callable review tools but cannot prevent an unrestricted shell-capable model from independently launching another process.

The reviewer reads a live workspace. Best-effort checks compare checkout HEAD, staged/unstaged diffs and untracked files before and after inspection. Large untracked files are checked by metadata only, and non-Git directories or inspection failures are disclosed. These checks can miss changes made and reverted between checks. A workspace-change warning means the report must not be treated as approval of the final working tree.

Artifacts are saved privately under `~/.pi/agent/reviewer/runs/review-*`:

- `request.json`, including conversation excerpts only when requested.
- `report.md` and `result.json`.
- `session.json`, the reviewer inspection transcript.

This state directory is ignored by this dotfiles repository, including when `~/.pi/agent` is a Stow symlink. Artifacts may contain sensitive source or conversation material; do not publish them blindly.

## Implementation and checks

The extension is `home/.pi/agent/extensions/reviewer/`. Pi discovers its `index.ts` automatically. Use `/reload` after installing it.

```bash
cd home/.pi/agent
npm run typecheck
node --test tests/reviewer.test.mjs
```

Tests exercise default verification, one-off adversarial fallback, parallel kitchen-sink reviews, mode-specific submission schemas, evidence requirements, unresolved-claim reporting, shared controls, option parsing, autocomplete, terminal widths, real SDK tool inspection and submission through a local model endpoint, isolated model selection, background continuation, cancellation, session changes and delayed result delivery.
