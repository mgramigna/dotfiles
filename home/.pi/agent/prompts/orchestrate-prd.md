---
description: Orchestrate serial PRD implementation through herdr sub-agents
argument-hint: '<parent GitHub issue URL or issue number> [extra instructions]'
---

You are the orchestrator for sub-agents implementing the slices of this parent PRD:

`${1}`

Extra instructions from the user, if any:

`${@:2}`

Your task is to coordinate a serial implementation through herdr. You are not the implementer unless explicitly needed for orchestration fixes.

Follow this workflow exactly:

1. Load and follow the `herdr` skill before doing any herdr operations.
   - Confirm `HERDR_ENV=1` before controlling herdr.
   - If you are not running inside herdr, stop and explain that this workflow requires a herdr-managed pane.

2. Fetch the parent PRD and discover sub-issues:
   - Use GitHub CLI (`gh`) where possible.
   - Fetch the parent issue body, comments, labels, state, and metadata.
   - Query the repository issue list for all sub-issues that reference this parent issue/PRD URL or issue number.
   - Include open sub-issues by default. If closed sub-issues are relevant for dependency analysis, inspect them too, but do not reimplement completed work.
   - If the parent issue cannot be resolved or sub-issues are ambiguous, ask for clarification.

3. Determine the implementation order:
   - Read each sub-issue enough to understand scope and dependencies.
   - Sort slices into a serial order that resolves prerequisites first.
   - Prefer foundational/schema/API/shared-code work before dependent UI/integration/testing slices.
   - Present the ordered list briefly before launching the first sub-agent.

4. Implement one slice at a time using a herdr sub-agent:
   - Do not run slices in parallel.
   - Launch exactly one new pi agent for the current slice in a new herdr pane from the current repository directory.
   - Use the current/default model and `low` reasoning, e.g. `pi --thinking low` unless the local pi CLI requires a different equivalent.
   - Prompt the sub-agent to load `/implement` and give it the sub-issue URL.
   - Include any important dependency/context notes from earlier slices.
   - Tell the sub-agent to implement the issue, run appropriate checks, and commit completed work to the current branch.

Use a sub-agent prompt shaped like this:

```text
/implement <sub-issue-url>

You are implementing this slice as part of parent PRD: ${1}

Important orchestration context:
- This work is being performed serially. Only implement this issue's scope.
- Preserve existing commits on the branch.
- Run appropriate tests/typechecks/lints for the touched area.
- Commit your completed work using a Conventional Commit message.
- Stop and ask if the issue is ambiguous, blocked, or requires product/design decisions.

Additional notes from orchestrator:
<dependency/context notes>
```

5. Monitor the sub-agent:
   - Use herdr pane/status commands to wait for progress and completion.
   - Periodically inspect output if the agent appears blocked or idle unexpectedly.
   - If the sub-agent asks for guidance, answer in that pane or take over only as needed to unblock orchestration.
   - Do not start the next slice until the current sub-agent is done.

6. Verify completion of each slice before moving on:
   - Confirm the sub-agent committed its work.
   - Inspect `git status --short --branch` and recent commits.
   - If the working tree is dirty because the sub-agent failed to commit, either ask it to finish or resolve the issue before continuing.
   - Briefly inspect the diff/commit summary for obvious scope mistakes.
   - Close the completed sub-agent pane once verified.

7. Continue until all sub-issues are complete.

8. Final report:
   - List each sub-issue handled, in order.
   - Include the commit hash/summary for each slice.
   - Mention any checks run or skipped.
   - Mention any remaining blockers, follow-ups, or sub-issues not implemented.

Rules:

- Be serial and dependency-aware.
- Keep orchestration state in your own notes/message, not in a separate plan file unless useful.
- Do not make broad implementation changes yourself unless required to fix orchestration fallout.
- Do not close GitHub issues unless explicitly instructed.
- Do not push or create a PR unless explicitly instructed.
- Incorporate the user's extra instructions: `${@:2}`.
