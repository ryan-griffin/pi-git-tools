/**
 * pi-git-tools — show integration tests.
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

describe("show", () => {
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

	it("git_show rejects option-like ref", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_show", { ref: "--exec=touch /tmp/x" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_show shows HEAD commit details", async () => {
		const result = await execTool(gitTools, "git_show");
		const text = result.content[0].text;
		assert.ok(text.length > 0, "show output is non-empty");
		// Should contain at least one of the known commit messages
		const hasCommit =
			text.includes("Initial commit") ||
			text.includes("Add src files") ||
			text.includes("Add stash-me.txt");
		assert.ok(
			hasCommit,
			`show output contains a known commit message, got: "${text.slice(0, 200)}..."`,
		);
	});

	it("git_show with stat returns a diffstat", async () => {
		const result = await execTool(gitTools, "git_show", { stat: true });
		assert.ok(result.details.stat, "stat flag is on");
	});
});
