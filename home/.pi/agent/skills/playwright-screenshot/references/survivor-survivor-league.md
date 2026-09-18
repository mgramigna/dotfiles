# survivor-survivor-league Playwright example

Use these conventions only when the current repository is `survivor-survivor-league` and verify they have not changed.

## Commands

From the repository root:

```bash
bun e2e:status
bun e2e:start
bun --cwd packages/e2e preflight
bun e2e:stop
bun --filter @ssl/e2e e2e <focused-spec>
```

The worktree dev servers are externally managed; the `webServer` block in `packages/e2e/playwright.config.ts` is disabled. `bun e2e:status` checks only the recorded parent process, not HTTP health. Use it to determine ownership/reuse, then use preflight to verify readiness. Stop the servers only when this screenshot workflow started them.

Run `bun --cwd packages/e2e preflight` **before** the focused package command. This order matters: preflight rejects unsafe test database names and waits for web/API readiness, while the package's `e2e` script runs its database migration before its own preflight. The separate initial preflight supplies the missing pre-migration safety check. Do not invoke the focused command if it fails.

For bounded diagnostics, read `.worktree/e2e-dev/server.log` with a finite command such as `tail -n 200`; `bun e2e:logs` follows indefinitely.

## Spec conventions

- Config: `packages/e2e/playwright.config.ts`
- Tests: `packages/e2e/tests/`
- Fixture: `packages/e2e/tests/fixtures/e2e.ts`
- Import the project fixture, usually:

```ts
import { expect, test } from "./fixtures/e2e";
```

Place the ephemeral spec directly under `packages/e2e/tests/` when that relative fixture import is appropriate. Use a unique name such as `pi-screenshot-<timestamp>.spec.ts`.

Use the `e2e` fixture's factories to create isolated test records. Representative helpers include `createUser`, `createSeasonWithCast`, and `createLeague`. Authenticate through `e2e.loginAs(context, user)`, which establishes the browser session through the real auth API. Mirror a nearby authenticated spec such as `packages/e2e/tests/league-home.spec.ts`; do not invent storage state or hard-coded credentials.

The default base URLs are typically web `http://localhost:5173` and API `http://localhost:3001`, but use relative navigation and the configured environment rather than hard-coding either URL.

## Safety and cleanup

- The test database must come from the repository's test environment; never substitute a development or production database.
- Pass `PI_SCREENSHOT_PATH` and the matching `PI_SCREENSHOT_TOKEN` through the focused command; read the path inside the temporary test after token-based skip protection.
- Remove the temporary spec after every run.
- Preserve the image under `${TMPDIR:-/tmp}` for inspection with `screenshot_view`.
