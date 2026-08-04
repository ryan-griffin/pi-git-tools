/**
 * pi-git-tools — revert integration tests.
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

describe("revert", () => {
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

	it("git_revert validates input", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_revert", { commit: "abc;def" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_revert creates an inverse commit", async () => {
		// Create a commit that we can revert
		const revertFile = "revert-me.txt";
		writeFileSync(resolve(repoPath, revertFile), "to be reverted\n");
		execFileSync("git", ["add", revertFile], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Commit to revert"], {
			cwd: repoPath,
		});

		const revertTarget = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repoPath,
			encoding: "utf-8",
		}).trim();

		const result = await execTool(gitTools, "git_revert", {
			commit: revertTarget,
			noCommit: true,
		});
		assert.ok(result.content[0].text.length > 0);

		// Abort the revert since noCommit was used
		execFileSync("git", ["revert", "--abort"], { cwd: repoPath });
	});

	it("git_revert rejects params on abort", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_revert", {
					action: "abort",
					noCommit: true,
				}),
			(err) =>
				err.message.includes("'noCommit' is only valid for action(s): revert"),
		);
	});
});
