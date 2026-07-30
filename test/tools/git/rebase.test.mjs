/**
 * pi-git-tools — rebase integration tests.
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("rebase", () => {
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

	it("git_rebase rejects option-like onto", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_rebase", {
					onto: "--exec=touch /tmp/x",
				}),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_rebase rebases a branch onto HEAD", async () => {
		const rebaseBranch = "test-rebase";
		try {
			// Stash dirty working tree so rebase can proceed
			execFileSync("git", ["stash", "--include-untracked"], {
				cwd: repoPath,
			});

			// Create a branch from HEAD~1 (one behind main)
			const behindCommit = execFileSync("git", ["rev-parse", "HEAD~1"], {
				cwd: repoPath,
				encoding: "utf-8",
			}).trim();
			execFileSync("git", ["checkout", "-b", rebaseBranch, behindCommit], {
				cwd: repoPath,
			});
			const rebaseFile = "rebase-file.txt";
			writeFileSync(resolve(repoPath, rebaseFile), "rebase content\n");
			execFileSync("git", ["add", rebaseFile], { cwd: repoPath });
			execFileSync("git", ["commit", "-m", "Rebase commit"], {
				cwd: repoPath,
			});

			// Rebase onto main
			const result = await execTool(gitTools, "git_rebase", {
				onto: "main",
			});
			assert.ok(result.details.onto === "main");
			assert.ok(result.content[0].text.length > 0);
		} finally {
			execFileSync("git", ["checkout", "main"], { cwd: repoPath });
			try {
				execFileSync("git", ["branch", "-D", rebaseBranch], {
					cwd: repoPath,
				});
			} catch {
				/* ok */
			}
		}
	});
});
