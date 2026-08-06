import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EFFECT_POLICY = String.raw`
React useEffect policy:
- Treat useEffect as an escape hatch, not a default tool. Reach for it only when synchronizing with an external system.
- Valid reasons include subscriptions, timers, imperative DOM/browser APIs, third-party widgets, sockets/connections, analytics beacons, and similar external side effects.
- Do not use useEffect for derived state, prop-to-state syncing, forcing re-renders, event handling, data transformations, or resetting component state. Prefer render-time derivation, event handlers, keys, reducers, memoization, refs, or component boundaries.
- If you add useEffect, include a nearby comment starting with "useEffect justified:" explaining the external system being synchronized with and why a render-time/event-driven alternative is insufficient.
`;

const SNARK = [
	"Blocked: attempted to summon useEffect. The council requests an actual external system.",
	"useEffect detected. Please step away from the lifecycle cosplay and derive the value during render if possible.",
	"Ah yes, useEffect: the junk drawer of React. Put this idea back unless it syncs with something outside React.",
	"The render function called. It says it can probably handle this without an effect.",
	"useEffect is not a state derivation machine with a funny hat. Try render-time logic first.",
	"This smells like prop-to-state synchronization, React's version of photocopying a photocopy.",
	"Effects are for the outside world. If the outside world is not involved, this is just ceremony wearing a trench coat.",
	"Blocked before this component becomes a tiny haunted state machine.",
	"React already re-renders. You do not need to poke it with a stick.",
	"A wild useEffect appeared. It hurt maintainability in its confusion.",
	"Please do not make future-you debug a dependency array escape room.",
	"Dependency arrays are not a personality. Justify the effect.",
	"This looks like derived state trying to sneak in through the service entrance.",
	"No external synchronization, no effect. Them's the vibes.",
	"The Hooks lint goblin is already sharpening its tiny pencils. Reconsider.",
	"useEffect detected. Somewhere, a perfectly good event handler is being ignored.",
	"If this is to reset state, use a key. React gave you one job-shaped prop for this.",
	"Blocked: the component was about to grow a second source of truth and a suspicious mustache.",
	"This effect has strong 'because it worked after the third dependency tweak' energy.",
	"Render is not lava. You are allowed to compute values there.",
	"Before adding this effect, ask: is it synchronizing with an external system, or just making React do paperwork?",
	"The effect monster requires tribute: a clear justification comment.",
	"useEffect without an external system is just a Rube Goldberg machine for assignment.",
	"Nope. The dependency array labyrinth is closed for renovations.",
	"This is how components become folklore. Add a justification or use a simpler pattern.",
	"Blocked: suspicious hook-shaped complexity entering the premises.",
	"If the goal is to force a re-render, congratulations: you have invented the key prop, badly.",
	"This useEffect needs a permission slip from an external system.",
	"Future maintainers deserve better than dependency-array archaeology.",
	"React effects are escape hatches. Please stop redecorating the living room with escape hatches.",
] as const;

const JUSTIFICATION_PATTERN = /useEffect\s+justified\s*:/i;
const USE_EFFECT_PATTERN = /\buseEffect\b/;
const REACT_FILE_PATTERN = /\.(?:jsx|tsx)$/i;

type EditInput = {
	path?: string;
	edits?: Array<{ oldText?: string; newText?: string }>;
};

type WriteInput = {
	path?: string;
	content?: string;
};

function pickSnark(): string {
	return SNARK[Math.floor(Math.random() * SNARK.length)] ?? SNARK[0];
}

function isReactFile(path: unknown): path is string {
	return typeof path === "string" && REACT_FILE_PATTERN.test(path);
}

function mentionsUseEffect(text: unknown): boolean {
	return typeof text === "string" && USE_EFFECT_PATTERN.test(text);
}

function hasJustification(text: unknown): boolean {
	return typeof text === "string" && JUSTIFICATION_PATTERN.test(text);
}

function blockReason(): string {
	return `${pickSnark()}\n\nIf this really is external synchronization, add a nearby comment like:\n// useEffect justified: synchronizing with <external system> because <reason>\n\nOtherwise use derived render state, an event handler, a key, a reducer, memoization, refs, or component boundaries instead.`;
}

function shouldBlockEdit(input: EditInput): boolean {
	if (!isReactFile(input.path) || !Array.isArray(input.edits)) return false;

	return input.edits.some((edit) => {
		const newText = edit.newText ?? "";
		const oldText = edit.oldText ?? "";
		return mentionsUseEffect(newText) && !mentionsUseEffect(oldText) && !hasJustification(newText);
	});
}

function shouldBlockWrite(input: WriteInput): boolean {
	if (!isReactFile(input.path) || !mentionsUseEffect(input.content)) return false;
	return !hasJustification(input.content);
}

export default function noUseEffect(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${EFFECT_POLICY}`,
	}));

	pi.on("tool_call", async (event) => {
		if (isToolCallEventType<"edit", EditInput>("edit", event) && shouldBlockEdit(event.input)) {
			return { block: true, reason: blockReason() };
		}

		if (isToolCallEventType<"write", WriteInput>("write", event) && shouldBlockWrite(event.input)) {
			return { block: true, reason: blockReason() };
		}
	});
}
