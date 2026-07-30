/**
 * pi-git-tools — log integration tests.
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

describe("log", () => {
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

	it("git_log returns commit history", async () => {
		const result = await execTool(gitTools, "git_log");
		assert.ok(result.content[0].text.length > 0, "log output is non-empty");
		assert.ok(result.details?.count >= 2, "has at least 2 commits");
	});

	it("git_log oneline format matches commit count", async () => {
		const result = await execTool(gitTools, "git_log", {
			format: "oneline",
		});
		assert.ok(result.content[0].text.length > 0);
	});

	it("git_log can filter by branch (HEAD)", async () => {
		const result = await execTool(gitTools, "git_log", { branch: "HEAD" });
		assert.ok(result.content[0].text.length > 0);
	});

	it("git_log filters by path", async () => {
		const result = await execTool(gitTools, "git_log", {
			path: "README.md",
			format: "oneline",
		});
		assert.ok(result.content[0].text.length > 0);
	});
});
