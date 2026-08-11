---
description: Create a GitHub stacked PR chain from completed PRD slice commits
argument-hint: '<parent GitHub issue URL or issue number> [base-branch] [extra instructions]'
---

Create a dependent GitHub stacked PR chain for a fully orchestrated PRD whose slice work has already been committed serially on the current branch.

Parent PRD: `$1`
Requested base branch, if provided: `${2:-repo default branch}`
Extra instructions: `${@:3}`

Follow this workflow exactly:

1. Load and follow the `gh-stack` skill before any `gh stack` operation.
   - Use non-interactive `gh stack` commands only.
   - Always pass required branch args to `init`/`add`/`checkout`.
   - Always use `gh stack submit --auto` and `gh stack view --json`.
   - Configure prompt-avoiding git defaults:
     - `git config rerere.enabled true`
     - `git config remote.pushDefault origin`

2. Inspect prerequisites and state:
   - `git status --short --branch`; stop if dirty.
   - `gh auth status` and `gh extension list`; stop if `gh stack` is unavailable.
   - Determine repo default branch with `gh repo view --json defaultBranchRef,nameWithOwner`.
   - Use the provided base branch if it resolves locally/remotely; otherwise use the repo default branch.
   - `git fetch origin <base-branch>` before computing ranges.

3. Discover PRD slices:
   - Fetch the parent issue with `gh issue view` including body/comments/labels/state/metadata.
   - Query all sub-issues that reference the parent issue number or URL.
   - Read each sub-issue enough to recover the intended dependency order.
   - Prefer the issue order/dependencies used during orchestration when visible from commit messages/session context.

4. Map slice commits:
   - Compute `merge_base=$(git merge-base <base-branch> HEAD)`.
   - Inspect `git log --reverse --oneline "$merge_base..HEAD"`.
   - Map each slice to the commit(s) that implemented it.
   - Best case: one commit per slice, in dependency order. Use those commits directly.
   - If extra commits exist, include only commits that belong to the PRD unless they are required prerequisites.
   - If a slice spans multiple commits or the mapping is ambiguous, stop and ask before pushing.
   - If the number/order of commits does not match the sub-issue dependencies, stop and explain the mismatch.

5. Choose branch names:
   - Create one branch per slice, bottom-to-top.
   - Use stable, readable names, preferably `<parent-number>-<slice-number>-<slug>` or `<parent-slug>-<slice-slug>`.
   - Check both local and remote branch collisions.
   - If a branch already exists at the exact intended commit, reuse it.
   - If a branch exists at a different commit, choose a clear suffixed name rather than overwriting.

6. Build the local stack from existing commits:
   - For one-commit-per-slice stacks, create/adopt branches pointing at each cumulative commit:
     - bottom branch points at the first slice commit
     - next branch points at the second slice commit
     - continue until top branch points at `HEAD`
   - Then run:
     - `gh stack init --base <base-branch> <branch-1> <branch-2> ... <branch-n>`
   - Verify with `gh stack view --json` that bases match the intended chain and `needsRebase` is false.

7. Submit GitHub stacked PRs:
   - Run `gh stack submit --auto --open --remote origin`.
   - Capture the command output because it includes created PR numbers and stack number.
   - Verify with `gh stack view --json`.
   - If submit reports stacked PRs unavailable, stop and report that GitHub Stacks must be enabled; do not fall back to unstacked PRs unless explicitly asked.

8. Optionally improve PR metadata if cheap and non-ambiguous:
   - For each PR, use `gh pr edit` to add a concise body with:
     - parent PRD link
     - sub-issue link
     - dependency note: base PR/branch below it
     - checks already run from orchestration if known
   - Do not invent checks.

9. Restore caller state:
   - Check out the original branch when practical.
   - Confirm `git status --short --branch` is clean.

10. Final report:
   - Include stack number if `gh stack submit` reported one.
   - List PRs in bottom-to-top order with branch, base, URL, and slice issue.
   - Mention any branch-name tricks/collisions.
   - Mention whether PR bodies were edited.
   - Mention current checked-out branch and cleanliness.

Rules:

- Do not rewrite, squash, amend, or reorder commits unless explicitly instructed.
- Do not merge PRs.
- Do not close GitHub issues.
- Do not push unrelated branches.
- Stop for dirty working tree, ambiguous commit-to-slice mapping, unresolved base branch, gh auth failure, or `gh stack` unavailability.
- Incorporate extra instructions: `${@:3}`.
