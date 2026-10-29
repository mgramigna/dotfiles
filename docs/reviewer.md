# Pi reviewer

`/review` runs one independent reviewer in the background. It accepts a free-form request, so it can review diffs, commits, branches, PRs, files, designs and ideas. The general subagent extension stays disabled.

## Commands

```text
/review
/review current diff, focusing on tenant isolation
/review commit abc123 for rollback regressions
/review PR https://github.com/example/project/pull/123
/review branch feature/scheduling against main
/review --context the caching proposal we discussed
/review --model openai-codex/gpt-6.1-sol --thinking xhigh current diff
/review status
/review hide
/review cancel
/review help
```

With no request, it reviews staged, unstaged and untracked changes. The default model is the current session's model at invocation time, with `high` reasoning. Overrides apply only to that review, not the main session. An unavailable or unauthenticated model fails rather than silently falling back. Models that do not support the requested reasoning level use their supported level; the panel and report show the effective level.

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

The live panel shows the target, model, reasoning, recent inspection tools, current activity, elapsed time, turns, token usage and cost. Keep chatting while it runs. `hide` hides the panel without cancelling; `status` restores it. Only one reviewer can run at a time.

The finished report is a collapsible conversation entry. Press `Ctrl+O` to expand it. If the main agent is still responding, the panel shows that the saved report is waiting. The extension appends it when the main agent settles. It never steers an ongoing response, requests another model turn or automatically applies fixes.

Changing session branches, switching sessions or reloading cancels running work and discards undelivered results, so a report cannot land on the wrong branch. Saved artifacts remain available. `/review status` shows the latest in-memory status until navigation or reload; persisted report entries remain in the session.

TUI and RPC commands return immediately. Print and JSON modes wait for the report. RPC exposes progress through `/review status`, not a terminal widget.

## Review behavior and limits

The reviewer investigates independently, challenges assumptions and tries to disprove findings before reporting them. Findings include severity, confidence, location, evidence, attempted falsification, failure mode and a suggested fix. Code findings use file locations; design findings can cite sections or quoted claims.

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

Tests exercise option parsing, autocomplete, terminal widths, real SDK tool inspection and submission through a local model endpoint, isolated model selection, background continuation, cancellation, session changes and delayed result delivery.
