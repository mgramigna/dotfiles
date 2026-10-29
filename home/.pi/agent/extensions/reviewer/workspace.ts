import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export interface WorkspaceStamp { head?: string; digest?: string; limitation?: string }

// Best-effort change detection, not a snapshot or proof of a stable workspace.
export async function workspaceStamp(cwd: string, signal: AbortSignal): Promise<WorkspaceStamp> {
	try {
		const git = async (args: string[]) => (await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
			cwd, signal, timeout: 10000, maxBuffer: 16 * 1024 * 1024, encoding: "buffer",
		})).stdout;
		await git(["rev-parse", "--show-toplevel"]);
		let head = "unborn HEAD";
		try { head = (await git(["rev-parse", "--verify", "HEAD"])).toString().trim(); } catch { signal.throwIfAborted(); }
		const hash = createHash("sha256");
		hash.update(head);
		const diffArgs = ["--no-ext-diff", "--no-textconv", "--binary", "--no-color"];
		hash.update(await git(["diff", "--cached", ...diffArgs]));
		hash.update("\0unstaged\0");
		hash.update(await git(["diff", ...diffArgs]));
		const files = (await git(["ls-files", "--others", "--exclude-standard", "-z"])).toString().split("\0").filter(Boolean).sort();
		let bytes = 0;
		let skipped = 0;
		for (const name of files) {
			signal.throwIfAborted();
			hash.update(`\0${name}\0`);
			const path = join(cwd, name);
			const stat = await lstat(path);
			hash.update(`${stat.mode}:${stat.size}:${stat.mtimeMs}`);
			if (stat.isSymbolicLink()) hash.update(await readlink(path));
			else if (stat.isFile() && stat.size <= 2 * 1024 * 1024 && bytes + stat.size <= 16 * 1024 * 1024) {
				bytes += stat.size;
				hash.update(await readFile(path, { signal }));
			} else skipped++;
		}
		return { head, digest: hash.digest("hex"), ...(skipped ? { limitation: `${skipped} large or special untracked file(s) checked by metadata only.` } : {}) };
	} catch (error) {
		signal.throwIfAborted();
		return { limitation: `Workspace change detection unavailable: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
	}
}
