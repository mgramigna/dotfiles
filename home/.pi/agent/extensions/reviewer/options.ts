import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export const thinkingLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export type ReviewMode = "verify" | "adversarial";
export const defaultScope = "Inspect the current uncommitted changes, including staged, unstaged and untracked files.";
const controls = ["status", "hide", "cancel", "help"] as const;

export interface ReviewOptions {
	mode: ReviewMode;
	scope: string;
	model?: string;
	thinking: ThinkingLevel;
	context: boolean;
	control?: typeof controls[number];
}

// Only leading options are parsed. The request itself is left verbatim, including quotes and flags.
export function parseOptions(input: string, mode: ReviewMode = "verify"): ReviewOptions {
	let rest = input.trim();
	const result: ReviewOptions = { mode, scope: defaultScope, thinking: "high", context: false };
	if (controls.includes(rest as typeof controls[number])) return { ...result, control: rest as typeof controls[number] };
	const seen = new Set<string>();
	while (rest.startsWith("--")) {
		const token = /^\S+/.exec(rest)![0];
		rest = rest.slice(token.length).trimStart();
		if (token === "--") break;
		const [flag, inline] = token.split(/=(.*)/s);
		if (!["--model", "--thinking", "--context"].includes(flag)) throw new Error(`Unknown review option: ${flag}. Use /review help.`);
		if (seen.has(flag)) throw new Error(`Repeated review option: ${flag}`);
		seen.add(flag);
		if (flag === "--context") {
			if (inline !== undefined) throw new Error("--context does not take a value");
			result.context = true;
			continue;
		}
		const value = inline ?? /^\S+/.exec(rest)?.[0];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
		if (inline === undefined) rest = rest.slice(value.length).trimStart();
		if (flag === "--model") {
			if (!/^[^/\s]+\/\S+$/.test(value)) throw new Error("Review model must be provider/model-id");
			result.model = value;
		} else {
			if (!thinkingLevels.includes(value as ThinkingLevel)) throw new Error(`Invalid thinking level: ${value}. Choose ${thinkingLevels.join(", ")}.`);
			result.thinking = value as ThinkingLevel;
		}
	}
	result.scope = rest || defaultScope;
	return result;
}

export function completeOptions(prefix: string, models: readonly string[]): AutocompleteItem[] | null {
	// Completion values replace the entire argument prefix, not just the current word.
	let offset = 0;
	const seen = new Set<string>();
	while (offset < prefix.length) {
		const whitespace = /^\s*/.exec(prefix.slice(offset))![0];
		offset += whitespace.length;
		const tail = prefix.slice(offset);
		if (!tail) break;
		const token = /^\S+/.exec(tail)![0];
		if (token === "--" && /\s/.test(tail.slice(token.length, token.length + 1))) return null;
		const [flag, inline] = token.split(/=(.*)/s);
		if (flag === "--model" || flag === "--thinking") {
			const choices = flag === "--model" ? models : thinkingLevels;
			const label = flag === "--model" ? "Use this model for this review only" : "Reasoning level for this review only";
			if (inline !== undefined) {
				if (offset + token.length === prefix.length) return choices.filter((v) => v.startsWith(inline)).map((v) => ({ value: `${prefix.slice(0, offset)}${flag}=${v} `, label: v, description: label }));
				offset += token.length;
			} else {
				const valueStart = offset + token.length + (/^\s*/.exec(tail.slice(token.length))![0].length);
				const value = /^\S+/.exec(prefix.slice(valueStart))?.[0] ?? "";
				if (valueStart + value.length === prefix.length) return choices.filter((v) => v.startsWith(value)).map((v) => ({ value: `${prefix.slice(0, offset)}${flag} ${v} `, label: v, description: label }));
				offset = valueStart + value.length;
			}
			seen.add(flag);
			continue;
		}
		if (flag === "--context" && offset + token.length < prefix.length) {
			seen.add(flag);
			offset += token.length;
			continue;
		}
		break;
	}
	const base = prefix.slice(0, offset);
	const partial = prefix.slice(offset);
	const items: AutocompleteItem[] = [
		{ value: "--model ", label: "--model", description: "Override provider/model-id" },
		{ value: "--thinking ", label: "--thinking", description: "Override reasoning, default high" },
		{ value: "--context ", label: "--context", description: "Include recent conversation text for ideas and proposals" },
		{ value: "-- ", label: "--", description: "End options; everything after this is the review request" },
		{ value: "current diff", label: "current diff", description: "Review staged, unstaged and untracked changes" },
		{ value: "commit ", label: "commit", description: "Add a commit SHA or ref" },
		{ value: "PR ", label: "PR", description: "Add a PR URL or number" },
		{ value: "branch ", label: "branch", description: "Describe a branch and its base" },
	];
	if (!base) items.push(...controls.map((value) => ({ value, label: value, description: { status: "Show the live panel or last result", hide: "Hide the panel without cancelling", cancel: "Cancel the background review", help: "Show review commands and options" }[value] })));
	const matches = items.filter((item) => !seen.has(item.label) && item.value.startsWith(partial)).map((item) => ({ ...item, value: base + item.value }));
	return matches.length ? matches : null;
}

export const help = `User-only background verification. Keep chatting while it runs.

/review [--model provider/model-id] [--thinking level] [--context] [--] <request>
/review-adversarial [same options] <request>
/review-kitchen-sink [same options] <request>
/review status | hide | cancel | help

/review verifies behavioral claims with source evidence; /review-adversarial uses the original adversarial reviewer for that invocation only.
/review-kitchen-sink runs both modes independently in parallel with the same request, model, reasoning and optional context, producing two reports.
All commands share one running task and the same status/hide/cancel/help controls. Cancel stops both kitchen-sink reviews.
Default: verification, current uncommitted changes, current model, high reasoning.
Options apply only to this review and must precede the request.
--context includes up to 24,000 characters of recent user/assistant text, useful for "the proposal above". No tool output, thinking or images is copied.
Use -- before a request that is itself "status", "hide", "cancel" or "help".
Results do not trigger a main-agent response or automatic fixes.
Reasoning is clamped to model capabilities and the effective level is shown.
Inspection is source-only. Bash is instructed to be read-only, not sandboxed.`;
