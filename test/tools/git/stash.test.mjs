/**
 * pi-git-tools — stash integration tests.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("stash", () => {
	let ctx;
	let repoPath;
	let gitTools;

	before(() => {
		const setup = setupTempRepo();
		repoPath = setup.repoPath;
		ctx = setup.ctx;
		execTool.ctx = ctx;
		gitTools = captureTools(registerGitTools);
	});

	after(() => {
		try {
			rmSync(repoPath, { recursive: true, force: true });
		} catch {
			/* ok */
		}
	});

	it("git_stash pop rejects keepIndex/includeUntracked", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "pop",
					keepIndex: true,
				}),
			(err) =>
				err.message.includes("'keepIndex' is only valid for action(s): push"),
		);
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "pop",
					includeUntracked: true,
				}),
			(err) =>
				err.message.includes(
					"'includeUntracked' is only valid for action(s): push",
				),
		);
	});

	it("git_stash apply rejects keepIndex/includeUntracked", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "apply",
					keepIndex: true,
				}),
			(err) =>
				err.message.includes("'keepIndex' is only valid for action(s): push"),
		);
	});

	it("git_stash rejects paths on pop", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "pop",
					paths: ["README.md"],
				}),
			(err) =>
				err.message.includes("'paths' is only valid for action(s): push"),
		);
	});

	it("git_stash rejects push-only params on drop/show/list", async () => {
		// Previously silently ignored; now rejected like pop/apply.
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "drop",
					includeUntracked: true,
				}),
			(err) =>
				err.message.includes(
					"'includeUntracked' is only valid for action(s): push",
				),
		);
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "show",
					message: "nope",
				}),
			(err) =>
				err.message.includes("'message' is only valid for action(s): push"),
		);
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "list",
					index: 2,
				}),
			(err) =>
				err.message.includes(
					"'index' is only valid for action(s): pop, apply, drop, show",
				),
		);
	});

	it("git_stash rejects show-only patch on other actions", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_stash", {
					action: "pop",
					patch: true,
				}),
			(err) =>
				err.message.includes("'patch' is only valid for action(s): show"),
		);
	});

	it("git_stash push stashes only the given paths", async () => {
		const keepFile = "keep.txt";
		const stashFile = "stash-path.txt";
		writeFileSync(resolve(repoPath, keepFile), "keep\n");
		writeFileSync(resolve(repoPath, stashFile), "stash\n");
		execFileSync("git", ["add", keepFile, stashFile], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add keep + stash-path"], {
			cwd: repoPath,
		});
		writeFileSync(resolve(repoPath, keepFile), "keep changed\n");
		writeFileSync(resolve(repoPath, stashFile), "stash changed\n");

		const result = await execTool(gitTools, "git_stash", {
			action: "push",
			paths: [stashFile],
			message: "only stash-path",
		});
		assert.equal(result.details.pathCount, 1);

		// stash-path.txt reverted to committed content, keep.txt still modified
		const stashContent = readFileSync(resolve(repoPath, stashFile), "utf-8");
		const keepContent = readFileSync(resolve(repoPath, keepFile), "utf-8");
		assert.equal(stashContent, "stash\n", "stashed path reverted");
		assert.equal(keepContent, "keep changed\n", "non-stashed path untouched");

		// cleanup: pop the stash so the repo stays consistent for later tests
		await execTool(gitTools, "git_stash", { action: "pop" });
	});

	it("git_stash push, list, and pop", async () => {
		const stashFile = "stash-me.txt";
		const originalContent = "original stash content\n";
		const changedContent = "changed stash content\n";

		// Create and commit a tracked file
		writeFileSync(resolve(repoPath, stashFile), originalContent);
		execFileSync("git", ["add", stashFile], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add stash-me.txt"], {
			cwd: repoPath,
		});

		// Modify it (unstaged change)
		writeFileSync(resolve(repoPath, stashFile), changedContent);

		// Push to stash
		const pushResult = await execTool(gitTools, "git_stash", {
			action: "push",
			message: "test stash",
			includeUntracked: false,
		});
		assert.ok(pushResult.details.action === "push");

		// Verify file is back to original (stash reverted the change)
		assert.equal(
			readFileSync(resolve(repoPath, stashFile), "utf-8"),
			originalContent,
			"file reverted after stash push",
		);

		// List stashes
		const listResult = await execTool(gitTools, "git_stash", {
			action: "list",
		});
		assert.ok(listResult.details.count >= 1, "at least one stash in list");

		// Pop the stash
		const popResult = await execTool(gitTools, "git_stash", {
			action: "pop",
		});
		assert.ok(popResult.details.action === "pop");

		// Verify file is back to modified content
		assert.equal(
			readFileSync(resolve(repoPath, stashFile), "utf-8"),
			changedContent,
			"file restored after stash pop",
		);

		// Cleanup: revert the file so it doesn't affect other tests
		execFileSync("git", ["checkout", "--", stashFile], { cwd: repoPath });
	});
});
