import { basename } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type GuardedOperation = {
	description: string;
	detail: string;
};

const ENV_BASENAME = ".env";

function isEnvPath(path: unknown): path is string {
	if (typeof path !== "string") return false;
	return basename(path.replace(/[/\\]+$/, "")) === ENV_BASENAME;
}

function commandMayReadEnv(command: string): boolean {
	// Match common shell references to a file whose basename is exactly `.env`.
	// This intentionally errs on the side of asking for confirmation for commands
	// such as `cat .env`, `grep FOO ../.env`, `source ./.env`, or `cp .env /tmp/x`.
	return /(^|[\s'"`=;|&()<>])(?:\.\/|\.\.\/|~\/|\/)?(?:[^\s'"`=;|&()<>]+\/)*\.env(?=$|[\s'"`;|&()<>])/i.test(command);
}

async function confirmEnvRead(operation: GuardedOperation, ctx: { hasUI: boolean; ui: { select: (message: string, choices: string[]) => Promise<string | undefined> } }) {
	if (!ctx.hasUI) {
		return { block: true, reason: ".env read blocked (no UI for confirmation)" };
	}

	const choice = await ctx.ui.select(
		`⚠️ pi is trying to read a .env file.\n\n${operation.description}:\n\n${operation.detail}\n\nAllow this one time?`,
		["Allow", "Block"],
	);

	if (choice !== "Allow") {
		return { block: true, reason: ".env read blocked by user" };
	}

	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "read" && isEnvPath(event.input.path)) {
			return confirmEnvRead(
				{
					description: "read tool path",
					detail: String(event.input.path),
				},
				ctx,
			);
		}

		if (event.toolName === "ffgrep" && isEnvPath(event.input.path)) {
			return confirmEnvRead(
				{
					description: "ffgrep path",
					detail: String(event.input.path),
				},
				ctx,
			);
		}

		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (commandMayReadEnv(command)) {
				return confirmEnvRead(
					{
						description: "bash command",
						detail: command,
					},
					ctx,
				);
			}
		}

		return undefined;
	});
}
