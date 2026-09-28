import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TRIGGER = "continue:trigger";

export default function (pi: ExtensionAPI) {
	// Keep trigger entries out of every model request, including after session reloads.
	pi.on("context", (event) => ({
		messages: event.messages.filter((message) => message.role !== "custom" || message.customType !== TRIGGER),
	}));

	function resume(ctx: ExtensionContext) {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Agent is still running", "warning");
			return;
		}

		if (ctx.ui.getEditorText().trim()) {
			ctx.ui.notify("Editor has a draft; submit or clear it first", "warning");
			return;
		}

		const lastMessage = ctx.sessionManager.getBranch()
			.filter((entry) => entry.type === "message")
			.at(-1);
		if (lastMessage?.type !== "message" || lastMessage.message.role !== "assistant" || lastMessage.message.stopReason !== "aborted") {
			ctx.ui.notify("No interrupted agent turn to continue", "info");
			return;
		}

		// Pi has no extension API for an idle, message-free continuation. Trigger
		// a turn with a hidden entry, then remove it from the model context above.
		pi.sendMessage({ customType: TRIGGER, content: [], display: false }, { triggerTurn: true });
	}

	pi.registerCommand("continue", {
		description: "Resume an interrupted agent turn without new instructions",
		handler: async (_args, ctx) => resume(ctx),
	});

	// A plain Enter on an empty editor is ignored by Pi. Extension shortcuts
	// consume the key even for nonempty drafts, so use Ctrl+Shift+Enter instead.
	pi.registerShortcut("ctrl+shift+enter", {
		description: "Continue an interrupted agent turn",
		handler: resume,
	});
}
