import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface CouncilConfig {
	members: { name: string; model: string; thinking: ThinkingLevel }[];
	maxDebateRounds: number;
	timeoutMinutes: number;
}

export const defaultConfig: CouncilConfig = {
	members: [
		{ name: "codex", model: "openai-codex/gpt-6.1-sol", thinking: "high" },
		{ name: "opus", model: "anthropic/claude-opus-5-5", thinking: "high" },
	],
	maxDebateRounds: 3,
	timeoutMinutes: 20,
};

export function parseConfig(value: unknown): CouncilConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Council config must be an object");
	const input = value as Record<string, unknown>;
	for (const key of Object.keys(input)) {
		if (!["members", "maxDebateRounds", "timeoutMinutes"].includes(key)) throw new Error(`Unknown council setting: ${key}`);
	}
	const members = input.members ?? defaultConfig.members;
	if (!Array.isArray(members) || members.length < 2 || members.length > 8) throw new Error("Council needs 2 to 8 members");
	const parsed = members.map((member: unknown) => {
		if (!member || typeof member !== "object") throw new Error("Invalid council member");
		const item = member as Record<string, unknown>;
		for (const key of Object.keys(item)) {
			if (!["name", "model", "thinking"].includes(key)) throw new Error(`Unknown member setting: ${key}`);
		}
		if (typeof item.name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.name)) throw new Error("Member name must use letters, numbers, underscores or hyphens");
		if (typeof item.model !== "string" || !/^[^/\s]+\/\S+$/.test(item.model)) throw new Error("Member model must be provider/model-id");
		const thinking = item.thinking ?? "high";
		if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(thinking))) throw new Error("Invalid thinking level");
		return { name: item.name, model: item.model, thinking: thinking as ThinkingLevel };
	});
	if (new Set(parsed.map((m) => m.name)).size !== parsed.length) throw new Error("Council member names must be unique");
	if (new Set(parsed.map((m) => m.model)).size !== parsed.length) throw new Error("Council members must use distinct models");
	const integer = (key: string, fallback: number, max: number) => {
		const n = input[key] ?? fallback;
		if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > max) throw new Error(`${key} must be an integer from 1 to ${max}`);
		return n;
	};
	return { members: parsed, maxDebateRounds: integer("maxDebateRounds", 3, 6), timeoutMinutes: integer("timeoutMinutes", 20, 120) };
}

export const configPath = () => join(getAgentDir(), "council.json");

export async function loadConfig(): Promise<CouncilConfig> {
	try {
		return parseConfig(JSON.parse(await readFile(configPath(), "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseConfig(defaultConfig);
		throw error;
	}
}
