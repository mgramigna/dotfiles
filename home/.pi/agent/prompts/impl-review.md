---
description: Implement a task, then run an adversarial reviewer
argument-hint: "<task>"
---
Implement this task end-to-end:

$ARGUMENTS

Requirements:
- Inspect the relevant files first.
- Make the smallest correct change.
- Run appropriate tests/typechecks if available.
- When implementation is done, delegate a review with the `subagent` tool using `agent: "reviewer"` and a task to inspect the local changes.
- If the reviewer reports defensible blocking findings, fix them and delegate the reviewer again.
- Finish with a concise summary of changes and verification.
