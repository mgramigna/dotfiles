---
name: pr
description: Commit, push, and open a GitHub pull request for the current work. Use when the user asks to submit, open, or create a PR from local changes.
---

# Create a pull request

Take the repository from its current staged and unstaged changes to an open GitHub pull request. Inspect the work, commit it, push the branch, and create the PR without pausing for routine confirmation.

## Workflow

1. Determine the repository's default branch with `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`. Use it as the PR base unless the user names another base.
2. Inspect the repository state:
   - `git status --short --branch`
   - `git diff --stat` and `git diff`
   - `git diff --cached --stat` and `git diff --cached`
   - If the branch has commits, inspect `git diff --stat <base>...HEAD` and `git diff <base>...HEAD`. If that range fails, resolve the correct local or remote base ref and retry.
3. Infer the PR's intent from the diff and conversation. Include all intended staged and unstaged changes unless the user says otherwise.
4. Stage the relevant files and create a Conventional Commit with the format `type(scope): short imperative summary`. Ask before committing only when changes are ambiguous, unrelated, risky, contain possible secrets, or need a user decision.
5. Use the same Conventional Commits format for the PR title.
6. Get the branch with `git branch --show-current`. If HEAD is detached or the current branch is the base or another protected branch, create a descriptive feature branch. Push with `git push -u origin <branch>` when it has no upstream, otherwise use `git push`.
7. Write the PR body to a temporary Markdown file and create the PR with `gh pr create`. Always submit PRs through the `gh` CLI.
8. If the user asks to include screenshots, pass each screenshot to the creation command with a separate `--attach '<path>#<alt text>'` flag. Use the actual screenshot files, not hand-written body links.
9. Report the PR URL, commit hash, branch name, and any tests not run.

Use this body structure:

```markdown
## Summary

-

## Changes

-
```

Keep the body terse. Summarize the intent and result at a high level. Give the reviewer context they cannot get by scanning the diff. Avoid file-by-file or symbol-by-symbol descriptions.

The body is about the change, not the agent session. Omit commands run, checks or type checks that passed, implementation play-by-play, and other process notes. CI reports routine verification.

Create the PR with this command shape:

```bash
gh pr create \
  --base <base> \
  --head <branch> \
  --title '<conventional title>' \
  --body-file <tmp-file> \
  [--attach '<screenshot-path>#<alt text>']
```

Incorporate relevant user instructions from the conversation. Stop only for ambiguity, unrelated changes, possible secrets, risk, or a missing decision.
