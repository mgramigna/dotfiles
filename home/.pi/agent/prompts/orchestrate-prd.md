---
description: Orchestrate serial PRD implementation through subagents
argument-hint: '<parent GitHub issue URL or issue number> [extra instructions]'
---

You are the orchestrator for sub-agents implementing the slices of this parent PRD:

`$1`

Extra instructions from the user, if any:

`${@:2}`

Your task is to coordinate a serial implementation through the `subagent` tool. You are not the implementer unless explicitly needed for orchestration fixes.

Follow this workflow exactly:

1. Fetch the parent PRD and discover sub-issues:
   - Use GitHub CLI (`gh`) where possible.
   - Fetch the parent issue body, comments, labels, state, and metadata.
   - Query the repository issue list for all sub-issues that reference this parent issue/PRD URL or issue number.
   - Include open sub-issues by default. If closed sub-issues are relevant for dependency analysis, inspect them too, but do not reimplement completed work.
   - If the parent issue cannot be resolved or sub-issues are ambiguous, ask for clarification.

2. Determine the implementation order:
   - Read each sub-issue enough to understand scope and dependencies.
   - Sort slices into a serial order that resolves prerequisites first.
   - Prefer foundational/schema/API/shared-code work before dependent UI/integration/testing slices.
   - Present the ordered list briefly before launching the first sub-agent.

3. Implement one slice at a time using the `subagent` tool:
   - Do not run slices in parallel.
   - Call `subagent` with `agent: "implementer"` for the current slice.
   - Include any important dependency/context notes from earlier slices.
   - Tell the sub-agent to implement the issue, run appropriate checks, and commit completed work to the current branch.

Use a sub-agent task shaped like this:

```text
Implement sub-issue <sub-issue-url> as part of parent PRD: $1.

This work is being performed serially. Only implement this issue's scope and preserve existing commits.
Run appropriate tests, typechecks, and lints for the touched area. Commit the completed work using a Conventional Commit message.
Stop and ask if the issue is ambiguous, blocked, or requires product/design decisions.

Additional notes from orchestrator:
<dependency/context notes>
```

4. Monitor the sub-agent result:
   - Wait for the `subagent` call to finish.
   - If it fails or reports that it is blocked, investigate and provide guidance before continuing.
   - Do not start the next slice until the current sub-agent is done.

5. Verify completion of each slice before moving on:
   - Confirm the sub-agent committed its work.
   - Inspect `git status --short --branch` and recent commits.
   - If the working tree is dirty because the sub-agent failed to commit, either ask it to finish or resolve the issue before continuing.
   - Briefly inspect the diff/commit summary for obvious scope mistakes.
   - Confirm the completed sub-agent has returned its summary before continuing.

6. Continue until all sub-issues are complete.

7. Optional stacked PR creation:
   - Only do this if the user's extra instructions explicitly request stacked PRs after orchestration, e.g. "stack after", "create stacked PRs", "push stack", or "open PRs after".
   - Do not infer this from ordinary implementation requests.
   - If requested, after all slices are complete, committed, and the working tree is clean, run the `/prd-stack $1` workflow with any relevant base-branch/PR instructions from `${@:2}`.
   - Tell `/prd-stack` that each PR description should include a closing issue link (for example `Closes #123`) for the slice issue it completes, if such an issue exists.
   - If stacked PR creation succeeds, include the stack/PR URLs in the final report.
   - If it is blocked, report the blocker and leave commits local.

8. Final report:
   - List each sub-issue handled, in order.
   - Include the commit hash/summary for each slice.
   - Mention any checks run or skipped.
   - Mention any remaining blockers, follow-ups, or sub-issues not implemented.
   - If stacked PRs were not requested and all slices are complete and committed, mention that `/prd-stack $1` can create the dependent GitHub PR stack when asked, and that each PR description should link the issue it closes if one exists.

Rules:

- Be serial and dependency-aware.
- Keep orchestration state in your own notes/message, not in a separate plan file unless useful.
- Do not make broad implementation changes yourself unless required to fix orchestration fallout.
- Do not close GitHub issues unless explicitly instructed.
- Do not push or create a PR unless explicitly instructed in the user's extra instructions.
- Incorporate the user's extra instructions: `${@:2}`.
