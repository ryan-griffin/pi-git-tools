/**
 * pi-git-tools — cherry_pick integration tests.
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

describe("cherry_pick", () => {
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

	it("git_cherry_pick validates commits array", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_cherry_pick", { commits: ["abc;123"] }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_cherry_pick can pick a commit", async () => {
		const pickBranch = "test-pick-source";
		try {
			// Create a branch with a unique commit
			execFileSync("git", ["checkout", "-b", pickBranch], {
				cwd: repoPath,
			});
			const pickFile = "pick-file.txt";
			writeFileSync(resolve(repoPath, pickFile), "pick content\n");
			execFileSync("git", ["add", pickFile], { cwd: repoPath });
			execFileSync("git", ["commit", "-m", "Pick me"], { cwd: repoPath });
			const pickCommit = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: repoPath,
				encoding: "utf-8",
			}).trim();

			// Go back to main and cherry-pick
			execFileSync("git", ["checkout", "main"], { cwd: repoPath });
			const result = await execTool(gitTools, "git_cherry_pick", {
				commits: [pickCommit],
			});
			assert.ok(result.content[0].text.length > 0);
			assert.ok(result.details.commits.includes(pickCommit));

			// Verify the picked file exists on main
			let exists = true;
			try {
				readFileSync(resolve(repoPath, pickFile));
			} catch {
				exists = false;
			}
			assert.ok(exists, "cherry-picked file exists on main");
		} finally {
			execFileSync("git", ["checkout", "main"], { cwd: repoPath });
			try {
				execFileSync("git", ["branch", "-D", pickBranch], {
					cwd: repoPath,
				});
			} catch {
				/* ok */
			}
		}
	});
});
