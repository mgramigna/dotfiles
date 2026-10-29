import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function conversationExcerpt(ctx: ExtensionContext, maxCharacters = 24000): string {
	const chunks: string[] = [];
	let remaining = maxCharacters;
	let truncated = false;
	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const content = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
		if (!content.trim()) continue;
		const chunk = `${message.role}:\n${content}`;
		if (remaining <= 0) { truncated = true; break; }
		chunks.push(chunk.slice(-remaining));
		remaining -= chunk.length;
		if (remaining < 0) { truncated = true; break; }
	}
	return `${truncated ? "[Older conversation omitted; the first excerpt may be truncated.]\n" : ""}${chunks.reverse().join("\n\n")}`;
}
