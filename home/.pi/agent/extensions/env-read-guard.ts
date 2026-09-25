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

const envPath = String.raw`(?:\.\/|\.\.\/)*\.env`;
const literalEnvPath = String.raw`(?:${envPath}|'${envPath}'|"${envPath}")`;
const existenceCheck = String.raw`-(?:e|f)[ \t]+${literalEnvPath}`;
const envExistenceCommand = new RegExp(String.raw`^[ \t]*(?:test[ \t]+${existenceCheck}|\[[ \t]+${existenceCheck}[ \t]+\]|\[\[[ \t]+${existenceCheck}[ \t]+\]\])[ \t]*$`);

function onlyChecksEnvExistence(command: string): boolean {
	// Recognize only simple commands joined by &&, ||, ;, or newlines.
	// Anything harder to parse falls back to confirmation, not an exemption.
	const segments: string[] = [];
	let start = 0;
	let quote = "";
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if ("$`\\".includes(char)) return false;
			if (char === quote) quote = "";
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		// Expansions, redirects, subshells, escapes, and comments need a shell parser.
		if ("$`\\<>(){}#".includes(char)) return false;
		if (char === ";" || char === "\n" || char === "&" || char === "|") {
			if (char === "&" || char === "|") {
				if (command[i + 1] !== char) return false;
				i++;
			}
			segments.push(command.slice(start, char === "&" || char === "|" ? i - 1 : i));
			start = i + 1;
		}
	}
	if (quote) return false;
	segments.push(command.slice(start));
	return segments.every((segment) => !commandMayReadEnv(segment) || envExistenceCommand.test(segment));
}

function commandMayReadEnv(command: string): boolean {
	// Match common shell references to a file whose basename is exactly `.env`.
	// This intentionally errs on the side of asking for confirmation for commands
	// such as `cat .env`, `grep FOO ../.env`, `source ./.env`, or `cp .env /tmp/x`.
	// Shell quote concatenation and backslash escaping can spell `.env` without
	// that exact substring appearing in the command (e.g. cat .e'n'v).
	const unquoted = command.replace(/[\\'"]/g, "");
	return /(^|[\s'"`=;|&()<>])(?:\.\/|\.\.\/|~\/|\/)?(?:[^\s'"`=;|&()<>]+\/)*\.env(?=$|[\s'"`;|&()<>])/i.test(unquoted);
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
			if (commandMayReadEnv(command) && !onlyChecksEnvExistence(command)) {
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
