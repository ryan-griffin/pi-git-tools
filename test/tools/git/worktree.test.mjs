/**
 * pi-git-tools — worktree integration tests.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("worktree", () => {
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

	it("git_worktree add creates a new branch", async () => {
		const worktreePath = resolve(tmpdir(), `pi-git-tools-wt-${Date.now()}`);
		const branchName = "feature/hotfix-test";
		try {
			const result = await execTool(gitTools, "git_worktree", {
				action: "add",
				path: worktreePath,
				branch: branchName,
			});
			assert.ok(
				result.content[0].text.length > 0,
				"worktree add output is non-empty",
			);
			assert.equal(result.details.branch, branchName);

			// Verify the branch was created
			const branches = execFileSync("git", ["branch"], {
				cwd: repoPath,
				encoding: "utf-8",
			});
			assert.ok(
				branches.includes(branchName),
				`branch ${branchName} exists after worktree add`,
			);
		} finally {
			// Cleanup: remove worktree, then the branch
			try {
				execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
					cwd: repoPath,
				});
			} catch {
				/* may not exist */
			}
			try {
				execFileSync("git", ["branch", "-D", branchName], {
					cwd: repoPath,
				});
			} catch {
				/* may not exist */
			}
		}
	});

	it("git_worktree add passes paths through verbatim (no trim)", async () => {
		// Trailing-space-only relative path: git creates the literal directory
		// (leading-space paths are rejected by validation — git would misread
		// them as relative and create garbage nested directories).
		const worktreePath = `wt-space-${Date.now()} `;
		try {
			const result = await execTool(gitTools, "git_worktree", {
				action: "add",
				path: worktreePath,
				detach: true,
			});
			assert.equal(
				result.details.path,
				worktreePath,
				"path is reported verbatim, not trimmed",
			);
			assert.ok(
				existsSync(resolve(repoPath, worktreePath)),
				"worktree directory created with literal trailing space",
			);
		} finally {
			try {
				execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
					cwd: repoPath,
				});
			} catch {
				/* may not exist */
			}
		}
	});

	it("git_worktree rejects leading-whitespace paths", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_worktree", {
					action: "add",
					path: " wt-space-bad",
					detach: true,
				}),
			(err) => err.message.includes("may not start with whitespace"),
		);
	});

	it("git_worktree list shows worktrees", async () => {
		const result = await execTool(gitTools, "git_worktree", {
			action: "list",
		});
		assert.ok(
			result.content[0].text.length > 0,
			"worktree list output is non-empty",
		);
		assert.ok(result.details.worktrees >= 1, "at least one worktree listed");
	});

	it("git_worktree rejects action-inapplicable params", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_worktree", {
					action: "prune",
					path: "some/path",
				}),
			(err) =>
				err.message.includes(
					"'path' is only valid for action(s): add, remove, lock, unlock",
				),
		);
	});
});
