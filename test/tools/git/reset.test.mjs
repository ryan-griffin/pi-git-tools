/**
 * pi-git-tools — reset integration tests.
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

describe("reset", () => {
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

	it("git_reset validates target param", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_reset", { target: "abc;def" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_reset rejects option-like target", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_reset", { target: "--hard" }),
			{
				name: "ValidationError",
			},
		);
	});
});
