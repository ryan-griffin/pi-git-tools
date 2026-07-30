/**
 * pi-git-tools — fetch integration tests.
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

describe("fetch", () => {
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

	it("git_fetch validates branch param", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_fetch", { branch: "branch;" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_fetch rejects depth with unshallow", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_fetch", { depth: 1, unshallow: true }),
			(err) => err.message.includes("mutually exclusive"),
		);
	});

	it("git_fetch rejects mutually exclusive options", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_fetch", { tags: true, noTags: true }),
			(err) => err.message.includes("mutually exclusive"),
		);
	});
});
