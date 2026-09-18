import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";

const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;

function detectImageMimeType(data: Buffer): "image/png" | "image/jpeg" | "image/webp" {
	if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return "image/png";
	}
	if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
		return "image/jpeg";
	}
	if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
		return "image/webp";
	}
	throw new Error("Screenshot must be a PNG, JPEG, or WebP image");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "screenshot_view",
		label: "View Screenshot",
		description: "Load a local PNG, JPEG, or WebP screenshot and attach it for visual inspection. Accepts absolute paths such as /tmp/... and paths relative to the current repository. Maximum file size: 20 MiB.",
		promptSnippet: "Load a local browser screenshot for visual inspection",
		promptGuidelines: [
			"Use screenshot_view after a Playwright or browser workflow produces a screenshot that needs visual inspection.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Absolute screenshot path, or a path relative to the current working directory" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.model?.input.includes("image")) {
				throw new Error("The active model cannot inspect images. Switch to a vision-capable model before using screenshot_view.");
			}

			const requestedPath = params.path.startsWith("@") ? params.path.slice(1) : params.path;
			const absolutePath = resolve(ctx.cwd, requestedPath);
			const canonicalPath = await realpath(absolutePath);
			const metadata = await stat(canonicalPath);
			if (!metadata.isFile()) throw new Error(`Not a file: ${canonicalPath}`);
			if (metadata.size > MAX_SCREENSHOT_BYTES) {
				throw new Error(`Screenshot is ${(metadata.size / 1024 / 1024).toFixed(1)} MiB; maximum is 20 MiB`);
			}

			const data = await readFile(canonicalPath);
			const mimeType = detectImageMimeType(data);
			return {
				content: [
					{ type: "text" as const, text: `Screenshot: ${canonicalPath} (${metadata.size} bytes)` },
					{ type: "image" as const, data: data.toString("base64"), mimeType },
				],
				details: { path: canonicalPath, bytes: metadata.size, mimeType },
			};
		},
	});
}
