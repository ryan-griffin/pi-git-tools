/**
 * pi-git-tools — blame integration tests.
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

describe("blame", () => {
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

	it("git_blame shows authorship for README.md", async () => {
		const result = await execTool(gitTools, "git_blame", {
			path: "README.md",
		});
		const text = result.content[0].text;
		assert.ok(text.length > 0, "blame output is non-empty");
		assert.ok(
			text.includes("Test User"),
			`blame shows Test User: "${text.slice(0, 200)}"`,
		);
	});

	it("git_blame with line range returns specific lines", async () => {
		const result = await execTool(gitTools, "git_blame", {
			path: "README.md",
			lineStart: 1,
			lineEnd: 2,
		});
		assert.ok(result.details.lineStart === 1);
		assert.ok(result.details.lineEnd === 2);
	});
});
