import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

const statePath = join(getAgentDir(), "codex-fast.json");
const statusKey = "06-codex-fast";

function readEnabled(): boolean {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) === true;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  let enabled = readEnabled();

  function updateStatus(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    const status = enabled && ctx.model?.provider === "openai-codex"
      ? `${ctx.ui.theme.fg("warning", "⚡")} ${ctx.ui.theme.fg("dim", "fast")}`
      : undefined;
    ctx.ui.setStatus(statusKey, status);
  }

  pi.on("session_start", (_event, ctx) => updateStatus(ctx));

  pi.on("model_select", (_event, ctx) => updateStatus(ctx));

  function setEnabled(value: boolean, ctx: ExtensionContext) {
    try {
      writeFileSync(statePath, `${JSON.stringify(value)}\n`, "utf8");
    } catch (error) {
      ctx.ui.notify(`Could not save Codex Fast mode: ${String(error)}`, "error");
      return;
    }
    enabled = value;
    updateStatus(ctx);
    ctx.ui.notify(`Codex Fast mode ${enabled ? "on" : "off"}`, "info");
  }

  pi.registerCommand("fast", {
    description: "Enable or disable Codex Fast mode across sessions",
    getArgumentCompletions(prefix) {
      const options = [
        { value: "on", label: "on", description: "Use priority processing for Codex requests" },
        { value: "off", label: "off", description: "Use standard processing for Codex requests" },
      ];
      return options.filter((option) => option.value.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      if (args === "on") setEnabled(true, ctx);
      else if (args === "off") setEnabled(false, ctx);
      else ctx.ui.notify("Usage: /fast on|off", "warning");
    },
  });

  pi.registerShortcut(Key.ctrlShift("r"), {
    description: "Toggle Codex Fast mode",
    handler: (ctx) => setEnabled(!enabled, ctx),
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || ctx.model?.provider !== "openai-codex") return;
    if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return;

    return { ...event.payload, service_tier: "priority" };
  });
}
