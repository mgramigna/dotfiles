---
name: playwright-screenshot
description: Capture and inspect application UI screenshots through a repository's existing Playwright end-to-end infrastructure. Use when the user asks to screenshot, visually inspect, or verify a page or UI state in a project that can run Playwright and its app server.
compatibility: Requires a repository with Playwright configured and a runnable application or Playwright webServer.
---

# Playwright screenshot

Capture the real application state through the repository's own E2E conventions. The temporary spec is disposable; the screenshot is the deliverable.

## Rules

- Adapt to the repository. Do not assume command names, package manager, test directory, ports, auth model, fixtures, or whether Playwright owns the server.
- Reuse project fixtures and setup. Do not bypass auth, seed ad hoc production data, or modify application code merely to reach the requested state.
- Keep the spec inside a directory matched by the project's Playwright config so its local imports, transforms, setup, and fixtures work.
- Use a collision-resistant spec name and refuse to overwrite an existing file.
- Put image output in an OS temp directory, not the repository. Preserve the final screenshot unless the user asks to delete it.
- Remove every temporary spec, including after a failed run. Stop a server only if this workflow started it.
- Never use broad cleanup commands such as `git clean` or delete unrelated test artifacts.

## Workflow

### 1. Discover the repository's E2E contract

Before writing anything, inspect:

1. Repository instructions (`AGENTS.md` and linked testing docs).
2. Root and E2E package scripts and the lockfile/package manager.
3. Playwright config: `testDir`, `testMatch`, projects, `use.baseURL`, `webServer`, global setup, dependencies, and environment loading.
4. Two or three nearby specs that exercise similar state.
5. Shared fixtures, auth helpers or storage state, data factories, setup projects, and required environment variables.
6. Existing server start/status/stop/log commands and whether a server is already running.
7. `git status --short` so temporary work cannot be confused with user changes.

Prefer the repository's documented focused-test command. If project-local instructions conflict with this skill, follow the project. Keep repository-specific commands and conventions in that repository's own instructions rather than adding them to this global skill.

### 2. Plan temporary paths and ownership

Create a temp output directory with the platform temp root rather than assuming `/tmp` exists:

```bash
tmp_root="${TMPDIR:-/tmp}"
shot_dir="$(mktemp -d "$tmp_root/pi-playwright-screenshot.XXXXXX")"
shot_path="$shot_dir/screenshot.png"
```

Choose a unique spec path under the discovered Playwright test directory, for example `pi-screenshot-<timestamp>.spec.ts`. Check that it does not exist before writing it. Generate a separate random run token so unrelated or concurrent Playwright runs skip the ephemeral spec. Record:

- spec path
- screenshot path
- run token
- whether this workflow started the server
- the matching stop command, if any

### 3. Start or reuse the application

- If Playwright config has a suitable `webServer`, let the focused test command manage it.
- Otherwise use the repository's documented status/readiness and start commands.
- Reuse a healthy existing server; do not claim ownership of it.
- Decide whether a manual start is needed here, but perform that start in the trapped shell in step 5 so interruption also runs cleanup.
- If the focused test command already runs readiness/preflight, do not invoke it separately; run the test command and inspect its output on failure. Otherwise wait using the project's documented readiness mechanism. Inspect bounded logs rather than following them indefinitely.

Do not improvise a second server command when the project already provides lifecycle scripts.

### 4. Write the ephemeral spec

Mirror the closest relevant spec's imports and fixture style. The spec should:

1. Create deterministic isolated state through existing factories/fixtures.
2. Authenticate through existing helpers, setup projects, or storage state.
3. Navigate with the configured base URL conventions.
4. Wait for a meaningful user-visible locator, not an arbitrary sleep.
5. Stabilize the intended viewport and UI state.
6. Skip unless `PI_SCREENSHOT_TOKEN` matches the unique token embedded in the spec. This prevents concurrent broad test runs from executing it.
7. Inside the test, read the destination from `PI_SCREENSHOT_PATH` and fail clearly when absent.
8. Capture with Playwright's `page.screenshot`.

Adapt this skeleton rather than copying it blindly:

```ts
import { expect, test } from "@playwright/test"; // Replace with the project's fixture import.

const captureToken = "<unique-random-token>";
test.skip(process.env.PI_SCREENSHOT_TOKEN !== captureToken, "ephemeral screenshot spec");
test.use({ viewport: { width: 1440, height: 1000 } });

test("capture requested state", async ({ page }) => {
  const screenshotPath = process.env.PI_SCREENSHOT_PATH;
  if (!screenshotPath) throw new Error("PI_SCREENSHOT_PATH is required");

  // Arrange state and authentication using project helpers.
  await page.goto("/requested-route");
  await expect(page.getByRole("heading", { name: "Expected page" })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: "disabled",
  });
});
```

Use `fullPage: false` when the request concerns the viewport or a responsive breakpoint. Use locator screenshots when only one component matters. Do not add snapshot assertions unless the user asked for visual regression coverage.

### 5. Run one focused spec and clean up

Pass both `PI_SCREENSHOT_PATH` and `PI_SCREENSHOT_TOKEN` to the discovered focused Playwright command. Run only the ephemeral spec, not the full suite. Start an owned server and run the test in one shell with traps so failure or interruption removes the spec and stops only that server:

```bash
server_started=0
cleanup() {
  status="${1:-$?}"
  trap - EXIT INT TERM HUP
  rm -f -- "$spec_path"
  if [ "$server_started" -eq 1 ]; then
    <documented-stop-command> || true
  fi
  exit "$status"
}
trap 'cleanup $?' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM HUP

# Omit this block when reusing a server or Playwright webServer.
<documented-start-command>
server_started=1
# Only if the focused test command does not already perform readiness checks:
<documented-readiness-command>

PI_SCREENSHOT_PATH="$shot_path" PI_SCREENSHOT_TOKEN="$capture_token" \
  <focused-playwright-command> "$spec_path"
```

Set `spec_path`, `shot_path`, and `capture_token` in that shell or substitute safely quoted literal values. When reusing an existing server, leave `server_started=0`; when Playwright owns `webServer`, omit manual lifecycle commands. If iterating after a failure, recreate the ephemeral spec and repeat the same cleanup discipline. Never leave it tracked or untracked in the repository. Verify `git status --short` no longer lists the temporary spec.

### 6. Inspect and report

Call `screenshot_view` with the final image path. Inspect the rendered result for the requested state, obvious clipping, overlays, loading/error states, missing assets, and viewport mistakes. If it is wrong, fix the ephemeral setup and recapture rather than editing the image.

Report:

- screenshot path
- route/state and viewport captured
- whether visual inspection found an issue
- any server or test failure

Keep the screenshot in its temp directory so the user can open or attach it later.
