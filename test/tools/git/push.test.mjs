/**
 * pi-git-tools — push integration tests.
 */
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("push", () => {
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

	it("git_push validates branch param", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_push", { branch: "branch;" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_push rejects mutually exclusive options", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_push", {
					force: true,
					forceWithLease: true,
				}),
			(err) => err.message.includes("both"),
		);
		await assert.rejects(
			() =>
				execTool(gitTools, "git_push", {
					deleteBranch: "old",
					branch: "main",
				}),
			(err) => err.message.includes("both"),
		);
	});
});
