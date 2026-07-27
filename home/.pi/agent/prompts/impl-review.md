---
description: Implement a task, then run overseer_review
argument-hint: "<task>"
---
Implement this task end-to-end:

$ARGUMENTS

Requirements:
- Inspect the relevant files first.
- Make the smallest correct change.
- Run appropriate tests/typechecks if available.
- When implementation is done, run the `overseer_review` tool on local changes.
- If overseer reports blocking findings, fix them and run `overseer_review` again.
- Finish with a concise summary of changes and verification.
