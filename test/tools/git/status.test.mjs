/**
 * pi-git-tools — status integration tests.
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

describe("status", () => {
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

	it("git_status shows working tree state", async () => {
		const result = await execTool(gitTools, "git_status");
		assert.ok(Array.isArray(result.content), "content is an array");
		assert.equal(result.content[0].type, "text");
		assert.ok(result.content[0].text.length > 0, "status output is non-empty");
		// Should mention our modified README.md and untracked file
		const text = result.content[0].text;
		assert.ok(text.includes("README.md") || text.includes("modified"), text);
	});

	it("git_status works with default options", async () => {
		const result = await execTool(gitTools, "git_status");
		assert.ok(result.content);
		assert.ok(result.content[0].text.length > 0);
	});
});
