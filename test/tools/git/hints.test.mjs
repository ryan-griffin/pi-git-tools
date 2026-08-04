/**
 * pi-git-tools — git error hint integration tests.
 *
 * Generates real git failures in temp repos and asserts the thrown
 * CommandError carries a tool-schema [Hint: ...] suffix. These pin the
 * hint table to the actual git messages this host produces (guarding
 * against git-version drift), complementing the synthetic fixtures in
 * test/unit/hints.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { assert, captureTools, execTool } from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

/** Minimal commit helper for test repos. */
function commit(cwd, message) {
	execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], {
		cwd,
	});
}

describe("git error hints", () => {
	let ctx;
	let repoPath;
	let gitTools;
	let scratch;

	before(() => {
		scratch = mkdtempSync(resolve(tmpdir(), "pi-git-tools-hints-"));
		repoPath = resolve(scratch, "repo");
		execFileSync("git", ["init", "-q", repoPath]);
		execFileSync("git", ["config", "user.name", "Test User"], {
			cwd: repoPath,
		});
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: repoPath,
		});
		ctx = { cwd: repoPath };
		execTool.ctx = ctx;
		gitTools = captureTools(registerGitTools);
	});

	after(() => {
		try {
			rmSync(scratch, { recursive: true, force: true });
		} catch {
			/* ok */
		}
	});

	it("hints when a tag already exists", async () => {
		commit(repoPath, "c1");
		execFileSync("git", ["tag", "v1"], { cwd: repoPath });
		await assert.rejects(
			() =>
				execTool(gitTools, "git_tag", {
					action: "create",
					name: "v1",
				}),
			(err) =>
				err.message.includes("already exists") &&
				err.message.includes("[Hint: ") &&
				err.message.includes("force: true"),
		);
	});

	it("hints when a ref does not resolve", async () => {
		commit(repoPath, "c1");
		await assert.rejects(
			() => execTool(gitTools, "git_show", { ref: "nope" }),
			(err) =>
				err.message.includes("ambiguous argument") &&
				err.message.includes("[Hint: ") &&
				err.message.includes("doesn't resolve"),
		);
	});

	it("hints when deleting an unmerged branch", async () => {
		commit(repoPath, "c1");
		execFileSync("git", ["checkout", "-q", "-b", "side-unmerged"], {
			cwd: repoPath,
		});
		commit(repoPath, "s1");
		execFileSync("git", ["checkout", "-q", "main"], { cwd: repoPath });
		await assert.rejects(
			() =>
				execTool(gitTools, "git_branch", {
					action: "delete",
					name: "side-unmerged",
				}),
			(err) =>
				err.message.includes("not fully merged") &&
				err.message.includes("[Hint: ") &&
				err.message.includes("force: true"),
		);
	});

	it("hints when a merge hits conflicts", async () => {
		writeFileSync(resolve(repoPath, "f.txt"), "base\n");
		execFileSync("git", ["add", "f.txt"], { cwd: repoPath });
		commit(repoPath, "c1");
		execFileSync("git", ["checkout", "-q", "-b", "side-merge"], {
			cwd: repoPath,
		});
		writeFileSync(resolve(repoPath, "f.txt"), "side\n");
		execFileSync("git", ["add", "f.txt"], { cwd: repoPath });
		commit(repoPath, "s1");
		execFileSync("git", ["checkout", "-q", "main"], { cwd: repoPath });
		writeFileSync(resolve(repoPath, "f.txt"), "main\n");
		execFileSync("git", ["add", "f.txt"], { cwd: repoPath });
		commit(repoPath, "c2");
		await assert.rejects(
			() => execTool(gitTools, "git_merge", { branch: "side-merge" }),
			(err) =>
				err.message.includes("CONFLICT") &&
				err.message.includes("[Hint: ") &&
				err.message.includes("continue"),
		);
		// Leave the repo clean for later tests.
		execFileSync("git", ["merge", "--abort"], { cwd: repoPath });
	});

	it("hints when pushing without an upstream", async () => {
		const remote = resolve(scratch, "remote.git");
		execFileSync("git", ["init", "-q", "--bare", remote]);
		commit(repoPath, "c1");
		execFileSync("git", ["remote", "add", "origin", remote], {
			cwd: repoPath,
		});
		await assert.rejects(
			() => execTool(gitTools, "git_push", {}),
			(err) =>
				err.message.includes("no upstream") &&
				err.message.includes("[Hint: ") &&
				err.message.includes("setUpstream: true"),
		);
	});

	it("hints when a branch is used by a worktree", async () => {
		commit(repoPath, "c1");
		const wtPath = resolve(scratch, "wt");
		execFileSync("git", ["worktree", "add", "-q", "-b", "wt-branch", wtPath], {
			cwd: repoPath,
		});
		await assert.rejects(
			() =>
				execTool(gitTools, "git_branch", {
					action: "delete",
					name: "wt-branch",
				}),
			(err) =>
				err.message.includes("used by worktree") &&
				err.message.includes("[Hint: ") &&
				err.message.includes("git_worktree remove"),
		);
		execFileSync("git", ["worktree", "remove", "-f", wtPath], {
			cwd: repoPath,
		});
		execFileSync("git", ["branch", "-D", "wt-branch"], { cwd: repoPath });
	});

	it("hints on a rejected push (diverged remote)", async () => {
		const remote = resolve(scratch, "reject.git");
		execFileSync("git", ["init", "-q", "--bare", remote]);
		// Point the existing origin at this remote (added by an earlier test).
		execFileSync("git", ["remote", "set-url", "origin", remote], {
			cwd: repoPath,
		});
		writeFileSync(resolve(repoPath, "f.txt"), "a\n");
		execFileSync("git", ["add", "f.txt"], { cwd: repoPath });
		commit(repoPath, "c1");
		execFileSync("git", ["push", "-q", "origin", "HEAD:main"], {
			cwd: repoPath,
		});
		// b: diverging commit pushed to main.
		const other = resolve(scratch, "other");
		execFileSync("git", ["clone", "-q", remote, other]);
		writeFileSync(resolve(other, "f.txt"), "b\n");
		execFileSync("git", ["add", "f.txt"], { cwd: other });
		execFileSync(
			"git",
			["-c", "user.email=o@o", "-c", "user.name=o", "commit", "-qm", "c2"],
			{ cwd: other },
		);
		execFileSync("git", ["push", "-q", "origin", "HEAD:main"], {
			cwd: other,
		});
		// a: local commit on top of the stale base → push rejected.
		writeFileSync(resolve(repoPath, "f.txt"), "a2\n");
		execFileSync("git", ["add", "f.txt"], { cwd: repoPath });
		commit(repoPath, "c3");
		await assert.rejects(
			() =>
				execTool(gitTools, "git_push", {
					remote: "origin",
					branch: "main",
				}),
			(err) =>
				err.message.includes("rejected") &&
				err.message.includes("[Hint: ") &&
				err.message.includes("forceWithLease: true"),
		);
	});

	it("leaves unknown errors unannotated", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_remote", {
					action: "get-url",
					name: "no-such-remote",
				}),
			(err) =>
				err.message.includes("No such remote") &&
				!err.message.includes("[Hint: "),
		);
	});
});
