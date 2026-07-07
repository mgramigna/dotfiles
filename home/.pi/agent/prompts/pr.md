---
description: Commit, push, and create a GitHub PR from the current local diff
argument-hint: '[base-branch] [extra instructions]'
---

Take the repository from the current local unstaged/staged diff to an open GitHub pull request. You are expected to inspect the changes, commit them, push the branch, and create the PR.

Arguments:

- Base branch: `${1:-main}`
- Extra instructions: `${@:2}`

Follow this workflow exactly:

1. Inspect repository state before doing anything:
   - `git status --short --branch`
   - `git diff --stat`
   - `git diff`
   - `git diff --cached --stat`
   - `git diff --cached`
   - Also inspect the branch diff against the base with `git diff --stat ${1:-main}...HEAD` and `git diff ${1:-main}...HEAD` when the branch already has commits. If the range fails, determine the upstream/base branch and retry with the correct range.

2. Summarize the local diff and infer the PR intent from the changes and conversation context.

3. Stage and commit the intended changes:
   - Include the current unstaged and staged diff unless the user explicitly says otherwise.
   - Use `git add` for the relevant files.
   - Create a Conventional Commit without asking for additional approval unless the diff is ambiguous, risky, contains secrets, or includes unrelated changes.
   - Commit message format: `type(scope): short imperative summary`.
   - Common types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `build`, `ci`, `perf`.

4. Ensure the PR title follows Conventional Commits too, e.g. `fix(avs): generate AVS for simplified visits`.

5. Push the branch:
   - Determine branch name with `git branch --show-current`.
   - If no branch exists or you are on a protected/base branch, create an appropriately named feature branch first.
   - If no upstream exists, use `git push -u origin <branch>`.
   - If upstream exists, use `git push`.

6. Create the PR using GitHub CLI only:
   - Write the PR body to a temporary Markdown file.
   - Run `gh pr create --base ${1:-main} --head <branch> --title "<conventional title>" --body-file <tmp-file>`.
   - Do not use web UI links or API calls unless `gh` is unavailable.

Use this PR body format:

```markdown
## Summary

-

## Changes

-
```

Rules:

- Keep the PR body concise but specific.
- Mention user-provided extra instructions if relevant: `${@:2}`.
- Start from the local unstaged/staged diff and proceed through commit, push, and PR creation without stopping for routine confirmations.
- Stop and ask only if changes are ambiguous, appear unrelated, include secrets, or require a decision the user has not provided.
- After creation, report the PR URL, commit hash, branch name, and any tests not run.
