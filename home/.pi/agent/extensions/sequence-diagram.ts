import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type MarkdownTransformContext = {
	messageType: "user" | "assistant" | "assistant-thinking";
	isStreaming: boolean;
	availableWidth: number;
};

type Participant = {
	id: string;
	label: string;
	kind: "participant" | "actor";
};

type MessageStatement = {
	kind: "message";
	from: string;
	to: string;
	arrow: string;
	text: string;
	number?: number;
};

type NoteStatement = {
	kind: "note";
	position: "over" | "right of" | "left of";
	targets: string[];
	text: string;
};

type DividerStatement = {
	kind: "divider";
	label: string;
};

type ActivationStatement = {
	kind: "activation";
	action: "activate" | "deactivate";
	participant: string;
};

type LifecycleStatement = {
	kind: "lifecycle";
	action: "create" | "destroy";
	participant: string;
};

type Statement = MessageStatement | NoteStatement | DividerStatement | ActivationStatement | LifecycleStatement;

type ParsedSequence = {
	participants: Participant[];
	statements: Statement[];
	title?: string;
};

type Layout = {
	participants: Participant[];
	positions: Map<string, number>;
	labelWidth: number;
	width: number;
};

const MAX_SOURCE_CHARS = 20_000;
const MAX_PARTICIPANTS = 12;
const MAX_STATEMENTS = 120;
const MAX_LABEL_WIDTH = 18;
const MAX_ARROW_GAP = 32;
const MIN_ARROW_GAP = 8;
const CACHE_LIMIT = 32;

const MERMAID_FENCE = /(^|\n)([ \t]*)```(?:mermaid|mmd)[ \t]*\r?\n([\s\S]*?)\r?\n\2```[ \t]*(?=\n|$)/gi;

const renderCache = new Map<string, string | undefined>();

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return trimmed.slice(1, -1).trim();
		}
	}
	return trimmed;
}

function compactText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	const text = compactText(value);
	if (text.length <= maxLength) return text;
	if (maxLength === 1) return "…";
	return `${text.slice(0, maxLength - 1)}…`;
}

function addParticipant(
	participants: Map<string, Participant>,
	idValue: string,
	labelValue?: string,
	kind: Participant["kind"] = "participant",
): boolean {
	const id = unquote(idValue);
	if (!id || /\s/.test(id)) return false;

	const existing = participants.get(id);
	if (existing) {
		if (labelValue) existing.label = unquote(labelValue);
		if (kind === "actor") existing.kind = kind;
		return true;
	}

	if (participants.size >= MAX_PARTICIPANTS) return false;
	participants.set(id, {
		id,
		label: unquote(labelValue ?? id),
		kind,
	});
	return true;
}

function parseParticipantDeclaration(
	line: string,
	participants: Map<string, Participant>,
): boolean | undefined {
	const match = line.match(/^(participant|actor)\s+(.+)$/i);
	if (!match) return undefined;

	const kind = match[1]?.toLowerCase() === "actor" ? "actor" : "participant";
	const declaration = match[2]?.trim() ?? "";
	const asMatch = declaration.match(/^(.*?)\s+as\s+(.+)$/i);
	const id = asMatch?.[1] ?? declaration;
	const label = asMatch?.[2];
	return addParticipant(participants, id, label, kind);
}

function parseMessage(line: string): MessageStatement | undefined {
	const match = line.match(
		/^([^\s:]+?)\s*(-->>|->>|--x|->x|--\)|-\)|-->|->|--|-x|-)(?:\s*)([^\s:]+?)(?:\s*:\s*(.*))?$/,
	);
	if (!match) return undefined;

	return {
		kind: "message",
		from: unquote(match[1] ?? ""),
		arrow: match[2] ?? "-",
		to: unquote(match[3] ?? ""),
		text: match[4] ?? "",
	};
}

function parseNote(line: string): NoteStatement | undefined {
	const match = line.match(/^note\s+(over|right of|left of)\s+(.+?)\s*:\s*(.*)$/i);
	if (!match) return undefined;

	const position = (match[1]?.toLowerCase() ?? "over") as NoteStatement["position"];
	const targetText = match[2] ?? "";
	const targets = (position === "over" ? targetText.split(",") : [targetText]).map(unquote).filter(Boolean);
	if (targets.length === 0) return undefined;

	return {
		kind: "note",
		position,
		targets,
		text: match[3] ?? "",
	};
}

function parseSequence(source: string): ParsedSequence | undefined {
	if (source.length > MAX_SOURCE_CHARS) return undefined;

	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const firstContent = lines.findIndex((line) => {
		const trimmed = line.trim();
		return trimmed !== "" && !trimmed.startsWith("%%");
	});
	if (firstContent < 0 || !/^sequenceDiagram\b/i.test(lines[firstContent]?.trim() ?? "")) {
		return undefined;
	}

	const participants = new Map<string, Participant>();
	const statements: Statement[] = [];
	const blocks: string[] = [];
	let title: string | undefined;
	let autoNumber = false;
	let messageNumber = 0;

	const ensure = (id: string): boolean => addParticipant(participants, id);
	const addStatement = (statement: Statement): boolean => {
		if (statements.length >= MAX_STATEMENTS) return false;
		statements.push(statement);
		return true;
	};

	for (let index = firstContent + 1; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? "";
		if (!line || line.startsWith("%%")) continue;

		const declarationResult = parseParticipantDeclaration(line, participants);
		if (declarationResult !== undefined) {
			if (!declarationResult) return undefined;
			continue;
		}

		const titleMatch = line.match(/^title\s+(.+)$/i);
		if (titleMatch) {
			title = compactText(titleMatch[1] ?? "");
			continue;
		}

		if (/^autonumber(?:\s+(?:on|\d+))?$/i.test(line)) {
			autoNumber = true;
			continue;
		}
		if (/^autonumber\s+off$/i.test(line)) {
			autoNumber = false;
			continue;
		}

		const note = parseNote(line);
		if (note) {
			if (!note.targets.every(ensure) || !addStatement(note)) return undefined;
			continue;
		}

		const openBlock = line.match(/^(loop|alt|opt|par|critical|break)\b(?:\s+(.*))?$/i);
		if (openBlock) {
			const label = compactText(`${openBlock[1] ?? ""}${openBlock[2] ? `: ${openBlock[2]}` : ""}`);
			blocks.push(openBlock[1]?.toLowerCase() ?? "block");
			if (!addStatement({ kind: "divider", label })) return undefined;
			continue;
		}

		const branch = line.match(/^(else|and)\b(?:\s+(.*))?$/i);
		if (branch) {
			if (blocks.length === 0) return undefined;
			const label = compactText(`${branch[1] ?? ""}${branch[2] ? `: ${branch[2]}` : ""}`);
			if (!addStatement({ kind: "divider", label })) return undefined;
			continue;
		}

		if (/^end$/i.test(line)) {
			if (blocks.pop() === undefined || !addStatement({ kind: "divider", label: "end" })) return undefined;
			continue;
		}

		const activation = line.match(/^(activate|deactivate)\s+(\S+)$/i);
		if (activation) {
			const participant = unquote(activation[2] ?? "");
			if (!ensure(participant)) return undefined;
			if (!addStatement({
				kind: "activation",
				action: activation[1]?.toLowerCase() as ActivationStatement["action"],
				participant,
			})) return undefined;
			continue;
		}

		const lifecycle = line.match(/^(create|destroy)\s+(?:participant\s+)?(\S+)$/i);
		if (lifecycle) {
			const participant = unquote(lifecycle[2] ?? "");
			if (!ensure(participant)) return undefined;
			if (!addStatement({
				kind: "lifecycle",
				action: lifecycle[1]?.toLowerCase() as LifecycleStatement["action"],
				participant,
			})) return undefined;
			continue;
		}

		const message = parseMessage(line);
		if (message) {
			if (!ensure(message.from) || !ensure(message.to)) return undefined;
			if (autoNumber) {
				messageNumber += 1;
				message.number = messageNumber;
			}
			if (!addStatement(message)) return undefined;
			continue;
		}

		// These directives affect Mermaid's browser renderer but do not add flow content.
		if (/^(?:show|hide|link|accTitle|accDescr)\b/i.test(line)) continue;

		// Unknown syntax is deliberately left as Mermaid source rather than rendered inaccurately.
		return undefined;
	}

	if (blocks.length > 0 || participants.size === 0) return undefined;
	return {
		participants: [...participants.values()],
		statements,
		...(title ? { title } : {}),
	};
}

function messageLabel(statement: MessageStatement): string {
	const prefix = statement.number === undefined ? "" : `${statement.number}. `;
	return compactText(`${prefix}${statement.text}`) || "·";
}

function makeLayout(parsed: ParsedSequence, availableWidth: number): Layout | undefined {
	const width = Number.isFinite(availableWidth) ? Math.max(1, Math.floor(availableWidth)) : 80;
	const participantCount = parsed.participants.length;
	const longestMessage = parsed.statements.reduce((longest, statement) => {
		if (statement.kind !== "message") return longest;
		return Math.max(longest, messageLabel(statement).length);
	}, 0);

	let labelWidth = Math.min(
		MAX_LABEL_WIDTH,
		Math.max(1, ...parsed.participants.map((participant) => compactText(participant.label).length)),
	);
	let gap = Math.min(MAX_ARROW_GAP, Math.max(MIN_ARROW_GAP, longestMessage + 6));

	if (participantCount > 1) {
		const maxGap = Math.floor((width - labelWidth * participantCount) / (participantCount - 1));
		if (maxGap < 2) {
			const maxLabelWidth = Math.floor((width - 2 * (participantCount - 1)) / participantCount);
			if (maxLabelWidth < 1) return undefined;
			labelWidth = Math.min(labelWidth, maxLabelWidth);
		}

		const adjustedMaxGap = Math.floor((width - labelWidth * participantCount) / (participantCount - 1));
		if (adjustedMaxGap < 2) return undefined;
		gap = Math.max(2, Math.min(gap, adjustedMaxGap));
	}

	if (participantCount === 1) {
		labelWidth = Math.min(labelWidth, width);
		const totalWidth = Math.min(width, Math.max(labelWidth, longestMessage + 10, 24));
		const positions = new Map<string, number>();
		positions.set(parsed.participants[0]!.id, Math.floor(totalWidth / 2));
		return { participants: parsed.participants, positions, labelWidth, width: totalWidth };
	}

	const stride = labelWidth + gap;
	const totalWidth = labelWidth * participantCount + gap * (participantCount - 1);
	if (totalWidth < 1 || totalWidth > width) return undefined;

	const positions = new Map<string, number>();
	parsed.participants.forEach((participant, index) => {
		positions.set(participant.id, index * stride + Math.floor(labelWidth / 2));
	});
	return { participants: parsed.participants, positions, labelWidth, width: totalWidth };
}

function row(width: number, active: Set<string>, layout: Layout): string[] {
	const chars = Array.from({ length: width }, () => " ");
	for (const participant of layout.participants) {
		const position = layout.positions.get(participant.id);
		if (position !== undefined && position >= 0 && position < width) {
			chars[position] = active.has(participant.id) ? "#" : "|";
		}
	}
	return chars;
}

function writeText(chars: string[], start: number, text: string): void {
	for (let index = 0; index < text.length; index += 1) {
		const position = start + index;
		if (position >= 0 && position < chars.length) chars[position] = text[index] ?? " ";
	}
}

function centeredText(width: number, text: string): string {
	const value = truncateText(text, width);
	const left = Math.max(0, Math.floor((width - value.length) / 2));
	return `${" ".repeat(left)}${value}`.padEnd(width, " ");
}

function renderHeader(layout: Layout): string {
	if (layout.participants.length === 1) {
		return centeredText(layout.width, layout.participants[0]!.label).trimEnd();
	}

	const chars = Array.from({ length: layout.width }, () => " ");
	const stride = (layout.positions.get(layout.participants[1]?.id ?? "") ?? 0)
		- (layout.positions.get(layout.participants[0]?.id ?? "") ?? 0);
	layout.participants.forEach((participant, index) => {
		writeText(chars, index * stride, centeredText(layout.labelWidth, participant.label));
	});
	return chars.join("").trimEnd();
}

function hasArrowHead(arrow: string): boolean {
	return arrow.endsWith(">>") || arrow.endsWith("x") || arrow.endsWith(")");
}

function isDashed(arrow: string): boolean {
	return arrow.startsWith("--");
}

function renderMessage(statement: MessageStatement, active: Set<string>, layout: Layout): string {
	const sender = layout.positions.get(statement.from);
	const receiver = layout.positions.get(statement.to);
	if (sender === undefined || receiver === undefined) return "";
	if (sender === receiver) {
		const chars = row(layout.width, active, layout);
		const label = truncateText(`[self: ${messageLabel(statement)}]`, layout.width);
		const rightStart = sender + 2;
		const leftStart = sender - label.length - 2;
		const start = rightStart + label.length <= layout.width
			? rightStart
			: Math.max(0, leftStart);
		writeText(chars, start, label);
		return chars.join("").trimEnd();
	}

	const chars = row(layout.width, active, layout);
	const low = Math.min(sender, receiver);
	const high = Math.max(sender, receiver);
	const lineChar = isDashed(statement.arrow) ? "." : "-";
	for (let position = low + 1; position < high; position += 1) chars[position] = lineChar;

	const pointsRight = sender < receiver;
	const arrowHead = hasArrowHead(statement.arrow) ? (statement.arrow.includes("x") ? "x" : pointsRight ? ">" : "<") : "";
	if (arrowHead) chars[pointsRight ? high - 1 : low + 1] = arrowHead;

	const textStart = low + 1 + (pointsRight && arrowHead ? 0 : arrowHead ? 1 : 0);
	const textEnd = high - 1 - (pointsRight && arrowHead ? 1 : 0);
	const textWidth = Math.max(0, textEnd - textStart + 1);
	const label = truncateText(messageLabel(statement), textWidth);
	if (label) {
		const start = textStart + Math.max(0, Math.floor((textWidth - label.length) / 2));
		writeText(chars, start, label);
	}

	// Restore the lifeline endpoints after drawing the horizontal message.
	chars[sender] = active.has(statement.from) ? "#" : "|";
	chars[receiver] = active.has(statement.to) ? "#" : "|";
	return chars.join("").trimEnd();
}

function renderNote(statement: NoteStatement, active: Set<string>, layout: Layout): string {
	const positions = statement.targets
		.map((target) => layout.positions.get(target))
		.filter((position): position is number => position !== undefined);
	if (positions.length === 0) return "";

	const chars = row(layout.width, active, layout);
	const marker = truncateText(`[note: ${statement.text}]`, layout.width);
	const low = Math.min(...positions);
	const high = Math.max(...positions);
	let start: number;
	if (statement.position === "right of") {
		start = high + 2;
	} else if (statement.position === "left of") {
		start = low - marker.length - 2;
	} else {
		start = Math.floor((low + high - marker.length) / 2);
	}
	start = Math.max(0, Math.min(start, layout.width - marker.length));
	writeText(chars, start, marker);
	return chars.join("").trimEnd();
}

function renderDivider(label: string, width: number): string {
	const prefix = `+-- ${truncateText(label, Math.max(1, width - 8))} `;
	if (prefix.length >= width) return prefix.slice(0, width);
	return `${prefix}${"-".repeat(Math.max(0, width - prefix.length - 2))}--+`;
}

function renderAnnotation(
	action: string,
	participant: string,
	active: Set<string>,
	layout: Layout,
): string {
	const chars = row(layout.width, active, layout);
	const position = layout.positions.get(participant) ?? 0;
	const text = truncateText(`[${action} ${participant}]`, layout.width);
	const rightStart = position + 2;
	const leftStart = position - text.length - 2;
	const start = rightStart + text.length <= layout.width
		? rightStart
		: Math.max(0, leftStart);
	writeText(chars, start, text);
	return chars.join("").trimEnd();
}

function renderSequence(parsed: ParsedSequence, availableWidth: number): string | undefined {
	const layout = makeLayout(parsed, availableWidth);
	if (!layout) return undefined;

	const lines: string[] = [];
	if (parsed.title) lines.push(truncateText(`# ${parsed.title}`, layout.width));
	lines.push(renderHeader(layout));
	const active = new Set<string>();
	lines.push(row(layout.width, active, layout).join("").trimEnd());

	for (const statement of parsed.statements) {
		switch (statement.kind) {
			case "message":
				lines.push(renderMessage(statement, active, layout));
				lines.push(row(layout.width, active, layout).join("").trimEnd());
				break;
			case "note":
				lines.push(renderNote(statement, active, layout));
				lines.push(row(layout.width, active, layout).join("").trimEnd());
				break;
			case "divider":
				lines.push(renderDivider(statement.label, layout.width));
				break;
			case "activation":
				if (statement.action === "activate") active.add(statement.participant);
				else active.delete(statement.participant);
				lines.push(renderAnnotation(statement.action, statement.participant, active, layout));
				break;
			case "lifecycle":
				lines.push(renderAnnotation(statement.action, statement.participant, active, layout));
				break;
		}
	}

	return lines.join("\n");
}

/** Render the supported Mermaid sequence-diagram subset for terminal display. */
export function renderSequenceDiagram(source: string, availableWidth = 80): string | undefined {
	const parsed = parseSequence(source);
	return parsed ? renderSequence(parsed, availableWidth) : undefined;
}

function cachedRender(source: string, availableWidth: number): string | undefined {
	const key = `${availableWidth}\u0000${source}`;
	if (renderCache.has(key)) return renderCache.get(key);

	const rendered = renderSequenceDiagram(source, availableWidth);
	if (renderCache.size >= CACHE_LIMIT) {
		const oldest = renderCache.keys().next().value;
		if (typeof oldest === "string") renderCache.delete(oldest);
	}
	renderCache.set(key, rendered);
	return rendered;
}

function transformMarkdown(markdown: string, context: MarkdownTransformContext): string {
	if (context.isStreaming || context.messageType === "assistant-thinking" || !markdown.includes("```")) return markdown;

	return markdown.replace(MERMAID_FENCE, (match, prefix: string, indent: string, source: string) => {
		const diagram = cachedRender(source, context.availableWidth);
		if (!diagram) return match;

		const indentedDiagram = diagram
			.split("\n")
			.map((line) => `${indent}${line}`)
			.join("\n");
		return `${prefix}${indent}\`\`\`text\n${indentedDiagram}\n${indent}\`\`\``;
	});
}

export default function sequenceDiagramExtension(pi: ExtensionAPI): void {
	if (typeof pi.registerMarkdownTransformer !== "function") {
		throw new Error("The sequence-diagram extension requires Pi 0.84.1 or newer; update Pi and reload extensions.");
	}
	pi.registerMarkdownTransformer((markdown, context) => transformMarkdown(markdown, context));
}
