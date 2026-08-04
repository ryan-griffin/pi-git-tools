/**
 * pi-git-tools — merge integration tests.
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

describe("merge", () => {
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

	it("git_merge validates branch param", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_merge", { branch: "bad;name" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_merge can merge a branch", async () => {
		const mergeBranch = "test-merge-source";
		const mergeTarget = "test-merge-target";
		try {
			// Create a source branch with a unique commit
			execFileSync("git", ["checkout", "-b", mergeBranch], {
				cwd: repoPath,
			});
			const mergeFile = "merge-file.txt";
			writeFileSync(resolve(repoPath, mergeFile), "merge content\n");
			execFileSync("git", ["add", mergeFile], { cwd: repoPath });
			execFileSync("git", ["commit", "-m", "Merge source commit"], {
				cwd: repoPath,
			});
			execFileSync("git", ["checkout", "main"], { cwd: repoPath });

			// Create a target branch from main and merge the source into it
			execFileSync("git", ["checkout", "-b", mergeTarget], {
				cwd: repoPath,
			});
			const result = await execTool(gitTools, "git_merge", {
				branch: mergeBranch,
			});
			assert.ok(result.details.branch === mergeBranch);
			assert.ok(result.content[0].text.length > 0);

			// Verify the merge file exists on target branch
			let exists = true;
			try {
				readFileSync(resolve(repoPath, mergeFile));
			} catch {
				exists = false;
			}
			assert.ok(exists, "merged file exists on target branch");
		} finally {
			execFileSync("git", ["checkout", "main"], { cwd: repoPath });
			try {
				execFileSync("git", ["branch", "-D", mergeBranch], {
					cwd: repoPath,
				});
			} catch {
				/* ok */
			}
			try {
				execFileSync("git", ["branch", "-D", mergeTarget], {
					cwd: repoPath,
				});
			} catch {
				/* ok */
			}
		}
	});

	it("git_merge rejects params on abort", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_merge", {
					action: "abort",
					branch: "test-merge-source",
				}),
			(err) =>
				err.message.includes("'branch' is only valid for action(s): merge"),
		);
	});
});
