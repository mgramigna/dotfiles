---
name: sequence-diagrams
description: Creates concise, terminal-friendly sequence diagrams for request flows, integrations, event pipelines, auth, and other interactions. Use whenever the user asks to visualize how components communicate or requests a sequence diagram.
---

# Sequence diagrams

When the user asks for a sequence diagram or an interaction flow:

1. Infer participants and message direction from the repository/context. Do not invent implementation details; state a brief assumption when needed.
2. Return a short explanation followed by one `mermaid` fenced block whose first line is `sequenceDiagram`.
3. Keep the Mermaid to the terminal renderer's supported subset:
   - `participant X` / `actor X`, optionally `as Label`
   - messages using `->>`, `-->>`, `->`, `-->`, `-x`, `--x`, `-)`, or `--)`
   - `Note over`, `Note right of`, and `Note left of`
   - `loop`, `alt`, `else`, `opt`, `par`, `and`, `critical`, `break`, and `end`
   - `activate`, `deactivate`, `create`, `destroy`, `autonumber`, and `title`
4. Use short stable participant IDs and concise message labels. Prefer 2–8 participants. Use `alt`/`else` or `loop` when the branch/retry is important.
5. Do not use `flowchart`, `box`, `rect`, Mermaid init directives, styling, or HTML. If the requested flow needs unsupported syntax, use the supported equivalent or explain the limitation.

The Pi terminal extension renders supported `sequenceDiagram` blocks as ASCII for display while preserving the Mermaid source in the session. The source remains copyable and portable to Mermaid editors.
