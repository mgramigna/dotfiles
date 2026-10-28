import { Type, type Static } from "typebox";

const text = () => Type.String({ minLength: 1, maxLength: 12000, pattern: "\\S" });
export const FindingSchema = Type.Object({
	title: text(),
	severity: Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2")]),
	location: text(),
	trigger: text(),
	consequence: text(),
	evidence: text(),
	falsification: text(),
	fix: text(),
}, { additionalProperties: false });

export const SubmissionSchema = Type.Object({
	reviewedScope: text(),
	scopeStatus: Type.Union([Type.Literal("complete"), Type.Literal("unavailable")]),
	findings: Type.Array(FindingSchema, { maxItems: 20 }),
	ballots: Type.Array(Type.Object({
		id: text(),
		revision: Type.Integer({ minimum: 1 }),
		verdict: Type.Union([Type.Literal("accept"), Type.Literal("reject"), Type.Literal("insufficient_evidence")]),
		reason: text(),
	}, { additionalProperties: false })),
	revisions: Type.Array(Type.Object({ id: text(), finding: FindingSchema }, { additionalProperties: false })),
	limitations: Type.Array(text(), { maxItems: 20 }),
}, { additionalProperties: false });

export type Finding = Static<typeof FindingSchema>;
export type Submission = Static<typeof SubmissionSchema>;
export interface Candidate {
	id: string;
	author: number;
	revision: number;
	finding: Finding;
	status: "pending" | "accepted" | "rejected";
}

export function independentCandidates(reviews: Submission[]): Candidate[] {
	return reviews.flatMap((review, author) => {
		if (review.ballots.length || review.revisions.length) throw new Error("Independent reviews cannot contain ballots or revisions");
		return review.findings.map((finding, i) => ({ id: `m${author + 1}-f${i + 1}`, author, revision: 1, finding, status: "pending" as const }));
	});
}

export function validateBallots(submission: Submission, candidates: Candidate[], member: number, allowRevisions: boolean): void {
	if (submission.findings.length) throw new Error("Debate cannot introduce unrelated new findings");
	const pending = candidates.filter((c) => c.status === "pending");
	if (submission.ballots.length !== pending.length) throw new Error("Submit exactly one ballot for every pending candidate");
	const seen = new Set<string>();
	for (const ballot of submission.ballots) {
		const candidate = pending.find((c) => c.id === ballot.id);
		if (!candidate || candidate.revision !== ballot.revision || seen.has(ballot.id)) throw new Error(`Unknown, duplicate or stale ballot: ${ballot.id}`);
		seen.add(ballot.id);
	}
	const revised = new Set<string>();
	for (const revision of submission.revisions) {
		const candidate = pending.find((c) => c.id === revision.id);
		if (!allowRevisions || !candidate || candidate.author !== member || revised.has(revision.id)) throw new Error(`Revision not allowed: ${revision.id}`);
		revised.add(revision.id);
	}
}

export function applyRound(candidates: Candidate[], responses: Submission[], allowRevisions: boolean): Candidate[] {
	if (responses.length < 2) throw new Error("Consensus requires at least two reviewers");
	responses.forEach((r, i) => validateBallots(r, candidates, i, allowRevisions));
	return candidates.map((candidate) => {
		if (candidate.status !== "pending") return candidate;
		const revision = responses[candidate.author].revisions.find((r) => r.id === candidate.id);
		// Every vote is invalidated when the substantive claim changes, including its author's vote.
		if (revision) return { ...candidate, finding: revision.finding, revision: candidate.revision + 1 };
		const votes = responses.map((r) => r.ballots.find((b) => b.id === candidate.id)!.verdict);
		const status = votes.every((v) => v === "accept") ? "accepted" : votes.every((v) => v === "reject") ? "rejected" : "pending";
		return { ...candidate, status };
	});
}

export function renderReport(candidates: Candidate[], limitations: string[], runDir: string, scopes: string[] = []): string {
	const accepted = candidates.filter((c) => c.status === "accepted").sort((a, b) => a.finding.severity.localeCompare(b.finding.severity));
	const pending = candidates.filter((c) => c.status === "pending").length;
	const findings = accepted.map(({ id, finding: f }) => `### [${f.severity}] ${f.title} (${id})\n- Location: ${f.location}\n- Trigger: ${f.trigger}\n- Consequence: ${f.consequence}\n- Evidence: ${f.evidence}\n- Falsification attempted: ${f.falsification}\n- Suggested fix: ${f.fix}`).join("\n\n");
	return `## Council review\n\n${accepted.length} unanimously accepted finding(s). ${pending} unresolved candidate(s) excluded.\n\n${findings || "No unanimously accepted findings. This is not a guarantee that the change is correct."}${scopes.length ? `\n\n## Reviewed scope\n${scopes.map((s) => `- ${s}`).join("\n")}` : ""}${limitations.length ? `\n\n## Inspection limitations\n${[...new Set(limitations)].map((l) => `- ${l}`).join("\n")}` : ""}\n\nFull discussion and inspection transcript: ${runDir}`;
}
