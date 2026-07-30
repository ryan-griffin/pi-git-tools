/**
 * pi-git-tools — branch integration tests.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("branch", () => {
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

	it("git_branch lists branches including feature/test", async () => {
		const result = await execTool(gitTools, "git_branch");
		const text = result.content[0].text;
		assert.ok(
			text.includes("feature/test"),
			"branch list includes feature/test",
		);
	});

	it("git_branch can create and delete a branch", async () => {
		const branchName = "test-create-delete";
		const createResult = await execTool(gitTools, "git_branch", {
			action: "create",
			name: branchName,
		});
		assert.ok(createResult.content[0].text.includes(branchName));

		// Verify the branch exists
		const branches = execFileSync("git", ["branch"], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(branches.includes(branchName), `branch ${branchName} exists`);

		// Delete it
		const deleteResult = await execTool(gitTools, "git_branch", {
			action: "delete",
			name: branchName,
		});
		assert.ok(deleteResult.content[0].text.includes(branchName));

		const afterBranches = execFileSync("git", ["branch"], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(
			!afterBranches.includes(branchName),
			`branch ${branchName} was deleted`,
		);
	});
});
