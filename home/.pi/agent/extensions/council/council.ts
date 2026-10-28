import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "typebox/value";
import {
	createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime,
	SessionManager, SettingsManager, type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { CouncilConfig } from "./config.ts";
import { applyRound, independentCandidates, renderReport, SubmissionSchema, validateBallots, type Candidate, type Submission } from "./protocol.ts";
import { debatePrompt, independentPrompt, reviewerPrompt } from "./prompts.ts";
import { createProgress, inspectionActivity, type CouncilProgress } from "./progress.ts";

interface MemberSession {
	session: AgentSession;
	submit: (prompt: string, validate: (submission: Submission) => void) => Promise<Submission>;
}

export interface CouncilRequest {
	cwd: string;
	scope: string;
	trusted: boolean;
	config: CouncilConfig;
	controller: AbortController;
	onProgress: (message: string) => void;
	onUpdate?: (progress: CouncilProgress) => void;
}

export async function runCouncil(request: CouncilRequest): Promise<{ report: string; runDir: string; incomplete: boolean }> {
	const { config, controller } = request;
	const { signal } = controller;
	const runsRoot = join(getAgentDir(), "council", "runs");
	await mkdir(runsRoot, { recursive: true, mode: 0o700 });
	const runDir = await mkdtemp(join(runsRoot, "review-"));
	const progress = createProgress(request.scope, config);
	progress.runDir = runDir;
	const emit = () => request.onUpdate?.(structuredClone(progress));
	const members: MemberSession[] = [];
	let candidates: Candidate[] = [];
	let failure: unknown;
	let report = "";
	const journal: unknown[] = [];
	const limitations: string[] = [];
	const timeout = setTimeout(() => controller.abort(new Error(`Council timed out after ${config.timeoutMinutes} minutes`)), config.timeoutMinutes * 60000);
	const persist = async () => {
		await writeFile(join(runDir, "discussion.json"), JSON.stringify({ config, cwd: request.cwd, scope: request.scope, journal, candidates }, null, 2), { mode: 0o600 });
		await Promise.all(members.map((member, i) => writeFile(join(runDir, `${config.members[i].name}.session.json`), JSON.stringify({ systemPrompt: member.session.systemPrompt, messages: member.session.messages }, null, 2), { mode: 0o600 })));
	};
	const abortSessions = () => { for (const member of members) void member.session.abort().catch(() => {}); };
	signal.addEventListener("abort", abortSessions);
	try {
		signal.throwIfAborted();
		emit();
		request.onProgress("Checking configured models...");
		journal.push({ phase: "request", cwd: request.cwd, scope: request.scope });
		const runtime = await ModelRuntime.create({ signal });
		const available = await runtime.getAvailable(undefined, { signal });
		const models = config.members.map((member) => {
			const model = available.find((m) => `${m.provider}/${m.id}` === member.model);
			if (!model) throw new Error(`Council model unavailable or unauthenticated: ${member.model}. Check /model, /login and council.json. No fallback was used.`);
			return model;
		});
		for (const [index, member] of config.members.entries()) {
			signal.throwIfAborted();
			let submitted: Submission | undefined;
			let validate: ((submission: Submission) => void) | undefined;
			const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 2 } });
			const loader = new DefaultResourceLoader({
				cwd: request.cwd, agentDir: getAgentDir(), settingsManager,
				noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
				noContextFiles: !request.trusted,
				systemPromptOverride: () => reviewerPrompt,
				appendSystemPromptOverride: () => [],
			});
			await loader.reload();
			const { session, modelFallbackMessage } = await createAgentSession({
				cwd: request.cwd, modelRuntime: runtime, model: models[index], thinkingLevel: member.thinking,
				resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(request.cwd),
				tools: ["read", "bash", "grep", "find", "ls", "council_submit"],
				customTools: [{
					name: "council_submit", label: "Submit council review", description: "Submit the current review phase's findings or ballots. Ends this phase.",
					parameters: SubmissionSchema,
					async execute(_id, input) {
						if (!validate || submitted) throw new Error("No council submission is currently expected");
						const message = session.messages.findLast((m) => m.role === "assistant");
						if (message?.role !== "assistant" || message.content.filter((c) => c.type === "toolCall").length !== 1) {
							throw new Error("Call council_submit alone, not alongside inspection tools or another submission");
						}
						if (!Value.Check(SubmissionSchema, input)) throw new Error("Invalid council submission schema");
						validate(input);
						submitted = structuredClone(input);
						return { content: [{ type: "text", text: "Submission recorded." }], details: undefined, terminate: true };
					},
				}],
			});
			// Cancellation during SDK auth/preflight can occur while abort() still sees an idle agent.
			// Recheck when the actual agent run starts, after its abort controller exists.
			session.subscribe((event) => {
				if (event.type === "agent_start" && signal.aborted) void session.abort().catch(() => {});
				const state = progress.members[index];
				if (event.type === "tool_execution_start") {
					state.activity = inspectionActivity(event.toolName, event.args);
					if (event.toolName !== "council_submit") state.tools++;
					emit();
				} else if (event.type === "message_end" && event.message.role === "assistant") {
					state.turns++;
					const usage = event.message.usage;
					state.tokens += usage?.totalTokens ?? 0;
					state.cost += usage?.cost.total ?? 0;
					emit();
				}
			});
			members.push({
				session,
				async submit(prompt, check) {
					submitted = undefined;
					validate = check;
					try {
						signal.throwIfAborted();
						progress.members[index].status = "working";
						progress.members[index].activity = progress.phase === "debating" ? "Checking peer evidence" : "Investigating independently";
						emit();
						request.onProgress(`${member.name}: investigating and preparing submission...`);
						await session.prompt(prompt);
						signal.throwIfAborted();
						if (!submitted) throw new Error(`${member.name} ended without a valid structured submission`);
						progress.members[index].status = "submitted";
						progress.members[index].activity = "Submitted · waiting for peers";
						emit();
						request.onProgress(`${member.name}: submitted`);
						return submitted;
					} finally { validate = undefined; }
				},
			});
			if (modelFallbackMessage || session.model?.id !== models[index].id || session.model?.provider !== models[index].provider) throw new Error(`Unexpected model fallback for ${member.name}`);
			journal.push({ phase: "member", name: member.name, model: member.model, thinking: session.thinkingLevel });
			signal.throwIfAborted();
		}
		await persist();
		// Fail the whole council on a missing member; cancel siblings and await cleanup before returning.
		const parallel = async (work: (member: MemberSession, index: number) => Promise<Submission>) => {
			const results = await Promise.allSettled(members.map(async (member, index) => {
				try { return await work(member, index); }
				catch (error) { controller.abort(error); throw error; }
			}));
			const failed = results.find((r) => r.status === "rejected");
			if (failed?.status === "rejected") throw signal.reason ?? failed.reason;
			return results.map((r) => (r as PromiseFulfilledResult<Submission>).value);
		};
		progress.phase = "reviewing";
		emit();
		request.onProgress("Independent reviews in progress...");
		const independent = await parallel((member, index) => member.submit(independentPrompt(request.scope, config.members[index].name, index), (s) => { independentCandidates([s]); }));
		candidates = independentCandidates(independent);
		progress.pending = candidates.length;
		emit();
		limitations.push(...independent.flatMap((r) => r.limitations));
		journal.push({ phase: "independent", responses: independent });
		await persist();
		const unavailable = independent.findIndex((r) => r.scopeStatus === "unavailable");
		if (unavailable !== -1) throw new Error(`${config.members[unavailable].name} could not inspect the requested scope: ${independent[unavailable].reviewedScope}. ${independent[unavailable].limitations.join("; ")}`);
		let previous: unknown = independent.map((r, i) => ({ member: config.members[i].name, reviewedScope: r.reviewedScope, limitations: r.limitations }));
		const scopes = independent.map((r) => r.reviewedScope);
		for (let round = 1; round <= config.maxDebateRounds && candidates.some((c) => c.status === "pending"); round++) {
			const pending = candidates.filter((c) => c.status === "pending");
			progress.phase = "debating";
			progress.round = round;
			for (const member of progress.members) { member.status = "waiting"; member.activity = "Waiting for discussion round"; }
			emit();
			request.onProgress(`Council debate ${round}/${config.maxDebateRounds}: ${pending.length} pending candidate(s)`);
			const prompt = debatePrompt(pending, previous, round, config.maxDebateRounds);
			const responses = await parallel((member, index) => member.submit(prompt, (s) => validateBallots(s, candidates, index, round < config.maxDebateRounds)));
			candidates = applyRound(candidates, responses, round < config.maxDebateRounds);
			progress.accepted = candidates.filter((c) => c.status === "accepted").length;
			progress.pending = candidates.filter((c) => c.status === "pending").length;
			emit();
			limitations.push(...responses.flatMap((r) => r.limitations));
			previous = responses.map((r, i) => ({ member: config.members[i].name, ...r }));
			responses.forEach((r, i) => { scopes[i] = r.reviewedScope; });
			journal.push({ phase: "debate", round, responses, candidates });
			await persist();
			const unavailable = responses.findIndex((r) => r.scopeStatus === "unavailable");
			if (unavailable !== -1) throw new Error(`${config.members[unavailable].name} could not verify the requested scope: ${responses[unavailable].reviewedScope}. ${responses[unavailable].limitations.join("; ")}`);
		}
		signal.throwIfAborted();
		report = renderReport(candidates, limitations, runDir, scopes.map((s, i) => `${config.members[i].name}: ${s}`));
		journal.push({ phase: "complete", reason: candidates.some((c) => c.status === "pending") ? "round_limit" : "all_candidates_resolved" });
	} catch (error) {
		failure = error;
		controller.abort(error);
		await Promise.allSettled(members.map((m) => m.session.abort()));
		journal.push({ phase: "incomplete", error: String(error) });
		report = `## Council review incomplete\n\n${String(error)}\n\nNo findings are reported because the full council review did not complete. This is not a clean review.\n\nDiscussion and inspection transcript: ${runDir}`;
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abortSessions);
		try {
			await persist();
			const stats = members.map((m, i) => ({ member: config.members[i].name, ...m.session.getSessionStats() }));
			await writeFile(join(runDir, "usage.json"), JSON.stringify(stats, null, 2), { mode: 0o600 });
			await writeFile(join(runDir, "report.md"), report, { mode: 0o600 });
		} finally { for (const member of members) member.session.dispose(); }
	}
	progress.phase = failure === undefined ? "complete" : "incomplete";
	progress.finishedAt = Date.now();
	emit();
	return { report, runDir, incomplete: failure !== undefined };
}
