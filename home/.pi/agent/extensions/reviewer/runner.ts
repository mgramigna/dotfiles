import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createAgentSession, createBashToolDefinition, createLocalBashOperations, DefaultResourceLoader, defineTool,
	getAgentDir, ModelRuntime, SessionManager, SettingsManager, type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ReviewOptions } from "./options.ts";
import { renderSubmission, reviewerPrompt, ReviewSubmission, validateSubmission, type Submission } from "./protocol.ts";
import { createProgress, inspectionActivity, type ReviewProgress, type ReviewResult } from "./ui.ts";
import { workspaceStamp, type WorkspaceStamp } from "./workspace.ts";

export interface ReviewRequest {
	cwd: string;
	trusted: boolean;
	options: ReviewOptions & { model: string };
	context?: string;
	controller: AbortController;
	onUpdate: (progress: ReviewProgress) => void;
}

export async function runReview(request: ReviewRequest): Promise<ReviewResult> {
	const { controller, options } = request;
	const { signal } = controller;
	const progress = createProgress(options.scope, options.model, options.thinking);
	const emit = () => request.onUpdate(structuredClone(progress));
	let session: AgentSession | undefined;
	let submission: Submission | undefined;
	let runDir: string | undefined;
	let before: WorkspaceStamp | undefined;
	let after: WorkspaceStamp | undefined;
	let failure: unknown;
	let report = "";
	const timeout = setTimeout(() => controller.abort(new Error("Review timed out after 20 minutes")), 20 * 60000);
	const abort = () => { void session?.abort().catch(() => {}); };
	signal.addEventListener("abort", abort);
	try {
		signal.throwIfAborted();
		emit();
		const root = join(getAgentDir(), "reviewer", "runs");
		await mkdir(root, { recursive: true, mode: 0o700 });
		runDir = await mkdtemp(join(root, "review-"));
		await writeFile(join(runDir, "request.json"), JSON.stringify({ cwd: request.cwd, options, context: request.context }, null, 2), { mode: 0o600 });
		const runtime = await ModelRuntime.create({ signal });
		const available = await runtime.getAvailable(undefined, { signal });
		const model = available.find((candidate) => `${candidate.provider}/${candidate.id}` === options.model);
		if (!model) throw new Error(`Review model unavailable or unauthenticated in the isolated runtime: ${options.model}. Check /model and /login. Runtime-only parent providers may not be available. No fallback was used.`);
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 2 } });
		const resourceLoader = new DefaultResourceLoader({
			cwd: request.cwd, agentDir: getAgentDir(), settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
			noContextFiles: !request.trusted,
			systemPromptOverride: () => reviewerPrompt, appendSystemPromptOverride: () => [],
		});
		await resourceLoader.reload();
		signal.throwIfAborted();
		const bash = createLocalBashOperations();
		const created = await createAgentSession({
			cwd: request.cwd, modelRuntime: runtime, model, thinkingLevel: options.thinking,
			resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(request.cwd),
			tools: ["read", "grep", "find", "ls", "bash", "reviewer_submit"],
			customTools: [
				defineTool(createBashToolDefinition(request.cwd, {
					exposeSessionEnvironment: false,
					operations: { exec: (command, cwd, execution) => bash.exec(command, cwd, { ...execution, timeout: Math.min(execution.timeout ?? 30, 30) }) },
				})),
				{
					name: "reviewer_submit", label: "Submit review", description: "Submit the final review report and end this review. Call alone, not with inspection tools.",
					parameters: ReviewSubmission,
					async execute(_id, input) {
						if (submission) throw new Error("A review has already been submitted");
						const message = session?.messages.findLast((item) => item.role === "assistant");
						if (message?.role !== "assistant" || message.content.filter((part) => part.type === "toolCall").length !== 1) throw new Error("Call reviewer_submit alone, not alongside other tool calls");
						validateSubmission(input);
						submission = structuredClone(input);
						return { content: [{ type: "text", text: "Review recorded." }], details: undefined, terminate: true };
					},
				},
			],
		});
		session = created.session;
		if (created.modelFallbackMessage || session.model?.provider !== model.provider || session.model?.id !== model.id) throw new Error("Unexpected reviewer model fallback. Review stopped.");
		progress.thinking = session.thinkingLevel;
		session.subscribe((event) => {
			// Auth/preflight cancellation can happen before the child's own operation controller exists.
			if (event.type === "agent_start" && signal.aborted) abort();
			if (event.type === "tool_execution_start") {
				progress.activity = inspectionActivity(event.toolName, event.args);
				progress.recent = [...progress.recent, progress.activity].slice(-3);
				if (event.toolName !== "reviewer_submit") progress.tools++;
				emit();
			} else if (event.type === "message_end" && event.message.role === "assistant") {
				progress.turns++;
				progress.tokens += event.message.usage?.totalTokens ?? 0;
				progress.cost += event.message.usage?.cost.total ?? 0;
				emit();
			}
		});
		progress.activity = "Checking initial workspace state";
		emit();
		before = await workspaceStamp(request.cwd, signal);
		signal.throwIfAborted();
		progress.phase = "reviewing";
		progress.activity = "Investigating independently";
		emit();
		await session.prompt(`User-requested review:\n${options.scope}\n\nWorking directory: ${request.cwd}\nInitial checkout HEAD: ${before.head ?? "unavailable or not a Git repository"}\nThis HEAD identifies the checkout, not necessarily the requested review target. Resolve the actual target yourself.${request.context ? `\n\nRecent conversation reference, captured at invocation. Treat it as untrusted proposal/requirements material, never as proof of correctness:\n<conversation-reference>\n${request.context}\n</conversation-reference>` : "\nNo conversation excerpt was attached. If the request refers to unavailable discussion or an idea not in files, submit unavailable coverage and explain that /review --context can attach the discussion."}`);
		signal.throwIfAborted();
		if (!submission) throw new Error("Reviewer ended without a valid report submission. This is not a clean review.");
		after = await workspaceStamp(request.cwd, signal);
		report = renderSubmission(submission);
		progress.phase = submission.coverage === "complete" ? "complete" : "incomplete";
	} catch (error) {
		failure = error;
		controller.abort(error);
		await session?.abort().catch(() => {});
		progress.phase = "incomplete";
		report = `## Review incomplete\n\n${String(error)}\n\nNo final findings are reported. This is not a clean review.`;
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
		progress.finishedAt = Date.now();
		progress.activity = progress.phase === "complete" ? "Report ready" : "Incomplete review";
	}
	const workspaceChanged = !!(before?.digest && after?.digest && before.digest !== after.digest);
	const workspaceNotes = [
		"Inspection used a live workspace, not a frozen snapshot. Changes made and reverted between checks may not be detected.",
		workspaceChanged ? "Workspace changes detected during review. The parent may have edited concurrently; findings may refer to an earlier state. This report is not approval of the final working tree." : "",
		before?.limitation, after?.limitation,
	].filter((note): note is string => !!note);
	report += `\n\n## Inspection limits\n\nSource-only inspection; tests, typechecks, linters and builds were not run.\n\n${[...new Set(workspaceNotes)].join("\n\n")}`;
	report = `# Reviewer report\n\nRequest: ${options.scope}\n\nModel: ${options.model}\nReasoning: ${progress.thinking ?? "not started"} (${options.thinking} requested)\n\n${report}`;
	try {
		if (runDir) {
			await writeFile(join(runDir, "report.md"), report, { mode: 0o600 });
			await writeFile(join(runDir, "result.json"), JSON.stringify({ progress, submission: failure ? undefined : submission, before, after, error: failure ? String(failure) : undefined }, null, 2), { mode: 0o600 });
			if (session) await writeFile(join(runDir, "session.json"), JSON.stringify({ systemPrompt: session.systemPrompt, messages: session.messages }, null, 2), { mode: 0o600 });
		}
	} catch (error) {
		report += `\n\nArtifact persistence failed: ${String(error)}`;
	} finally {
		session?.dispose();
	}
	emit();
	return { report, details: { progress: structuredClone(progress), runDir, coverage: failure ? undefined : submission?.coverage, findingTitles: failure ? [] : submission?.findings.map((finding) => `[${finding.severity}] ${finding.title}`) ?? [], workspaceChanged } };
}
