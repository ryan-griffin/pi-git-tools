/**
 * pi-git-tools — restore integration tests.
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

describe("restore", () => {
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

	it("git_restore restores a modified file from the index", async () => {
		const restorePath = "restore-test.txt";
		writeFileSync(resolve(repoPath, restorePath), "original\n");
		execFileSync("git", ["add", restorePath], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add restore-test.txt"], {
			cwd: repoPath,
		});
		// Modify it
		writeFileSync(resolve(repoPath, restorePath), "modified\n");
		const result = await execTool(gitTools, "git_restore", {
			paths: [restorePath],
		});
		const restored = readFileSync(resolve(repoPath, restorePath), "utf-8");
		assert.equal(restored.trim(), "original");
		assert.ok(result.content[0].text.length > 0);
		assert.equal(result.details.source, null);
		assert.equal(result.details.worktree, true);
		assert.equal(result.details.staged, false);
		assert.equal(result.details.ignoreUnmerged, false);
		assert.equal(result.details.recurseSubmodules, false);
		assert.equal(result.details.overlay, true);
	});

	it("git_restore --staged unstages a file", async () => {
		const unstagePath = "to-unstage.txt";
		writeFileSync(resolve(repoPath, unstagePath), "will be staged\n");
		execFileSync("git", ["add", unstagePath], { cwd: repoPath });
		// Verify it's staged
		const beforeStatus = execFileSync(
			"git",
			["status", "--porcelain", unstagePath],
			{
				cwd: repoPath,
				encoding: "utf-8",
			},
		);
		assert.ok(
			beforeStatus.startsWith("A ") || beforeStatus.startsWith("M "),
			`${unstagePath} is staged before restore`,
		);

		const result = await execTool(gitTools, "git_restore", {
			paths: [unstagePath],
			staged: true,
			worktree: false,
		});
		// After unstaging the staged file, it should be untracked (since it was added)
		const afterStatus = execFileSync(
			"git",
			["status", "--porcelain", unstagePath],
			{
				cwd: repoPath,
				encoding: "utf-8",
			},
		);
		// Should no longer be staged — may show as "?? " (untracked) or nothing
		assert.ok(
			!afterStatus.startsWith("A "),
			`${unstagePath} is no longer staged`,
		);
		assert.ok(result.content[0].text.length > 0);
		assert.equal(result.details.staged, true);
		assert.equal(result.details.worktree, false);
	});

	it("git_restore --staged with source re-points index entries", async () => {
		// Stage a change to a tracked file, then restore the index against HEAD
		// — the index entry must go back to the committed version while the
		// working tree keeps the staged change (modern replacement for
		// `git reset <target> -- <paths>`).
		const targetFile = "restore-source.txt";
		writeFileSync(resolve(repoPath, targetFile), "committed\n");
		execFileSync("git", ["add", targetFile], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add restore-source.txt"], {
			cwd: repoPath,
		});
		writeFileSync(resolve(repoPath, targetFile), "staged change\n");
		execFileSync("git", ["add", targetFile], { cwd: repoPath });

		const result = await execTool(gitTools, "git_restore", {
			paths: [targetFile],
			staged: true,
			worktree: false,
			source: "HEAD",
		});
		assert.equal(result.details.source, "HEAD");
		assert.equal(result.details.staged, true);
		assert.equal(result.details.worktree, false);

		const indexVersion = execFileSync("git", ["show", `:${targetFile}`], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.equal(
			indexVersion,
			"committed\n",
			"index entry restored to the source commit's version",
		);
		// Working tree keeps the staged change.
		const worktreeVersion = readFileSync(
			resolve(repoPath, targetFile),
			"utf-8",
		);
		assert.equal(worktreeVersion, "staged change\n");
	});

	it("git_restore validates empty paths", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_restore", { paths: [] }),
			{
				name: "Error",
			},
		);
	});

	it("git_restore validates invalid path", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_restore", { paths: ["../outside"] }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_restore validates invalid source", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_restore", {
					paths: ["README.md"],
					source: "abc;def",
				}),
			{ name: "ValidationError" },
		);
	});

	it("git_restore rejects ours+theirs conflict", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_restore", {
					paths: ["README.md"],
					ours: true,
					theirs: true,
				}),
			(err) => err.message.includes("mutually exclusive"),
		);
	});

	it("git_restore rejects source+ours/theirs conflict", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_restore", {
					paths: ["README.md"],
					source: "HEAD",
					ours: true,
				}),
			(err) => err.message.includes("source"),
		);
	});

	it("git_restore --no-overlay applies flag", async () => {
		// Create a file that exists in HEAD but modify it, then restore
		const overlayPath = "overlay-test.txt";
		writeFileSync(resolve(repoPath, overlayPath), "head version\n");
		execFileSync("git", ["add", overlayPath], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add overlay-test.txt"], {
			cwd: repoPath,
		});
		// Modify the file
		writeFileSync(resolve(repoPath, overlayPath), "modified\n");
		const result = await execTool(gitTools, "git_restore", {
			paths: [overlayPath],
			overlay: false,
		});
		assert.equal(result.details.overlay, false);
		const restored = readFileSync(resolve(repoPath, overlayPath), "utf-8");
		assert.equal(restored.trim(), "head version");
	});
});
