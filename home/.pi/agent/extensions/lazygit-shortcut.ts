import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SHORTCUT = process.env.PI_LAZYGIT_SHORTCUT || "f2";
const FALLBACK_SHORTCUT = process.env.PI_LAZYGIT_FALLBACK_SHORTCUT || "ctrl+shift+g";

async function openLazygit(ctx: ExtensionContext) {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("lazygit shortcut only works in the TUI", "error");
		return;
	}

	await ctx.ui.custom<number | null>((tui, _theme, _keybindings, done) => {
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");

		const result = spawnSync("lazygit", [], {
			cwd: ctx.cwd,
			stdio: "inherit",
			env: process.env,
		});

		tui.start();
		tui.requestRender(true);

		if (result.error) {
			ctx.ui.notify(`Failed to open lazygit: ${result.error.message}`, "error");
		} else if (result.status && result.status !== 0) {
			ctx.ui.notify(`lazygit exited with code ${result.status}`, "warn");
		}

		done(result.status);
		return { render: () => [], invalidate: () => {} };
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("lazygit", {
		description: "Open lazygit in the current working directory",
		handler: async (_args, ctx) => {
			await openLazygit(ctx);
		},
	});

	pi.registerShortcut(SHORTCUT, {
		description: "Open lazygit",
		handler: openLazygit,
	});

	pi.registerShortcut(FALLBACK_SHORTCUT, {
		description: "Open lazygit",
		handler: openLazygit,
	});
}
