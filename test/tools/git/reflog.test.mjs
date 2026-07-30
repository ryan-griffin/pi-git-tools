/**
 * pi-git-tools — git_reflog integration tests.
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

describe("reflog", () => {
	let repoPath;
	let gitTools;

	before(() => {
		const setup = setupTempRepo();
		repoPath = setup.repoPath;
		execTool.ctx = setup.ctx;
		gitTools = captureTools(registerGitTools);
	});

	after(() => {
		try {
			rmSync(repoPath, { recursive: true, force: true });
		} catch {
			/* ok */
		}
	});

	it("git_reflog lists HEAD entries", async () => {
		const result = await execTool(gitTools, "git_reflog");
		assert.ok(result.details.count >= 1, "has at least one reflog entry");
		assert.ok(
			result.content[0].text.includes("HEAD@"),
			"uses reflog selector format",
		);
	});

	it("git_reflog respects limit", async () => {
		const result = await execTool(gitTools, "git_reflog", { limit: 1 });
		assert.equal(result.details.count, 1, "limited to one entry");
	});

	it("git_reflog supports custom format and ref", async () => {
		const result = await execTool(gitTools, "git_reflog", {
			format: "%gs",
			ref: "HEAD",
		});
		assert.ok(result.content[0].text.length > 0, "custom format output");
	});

	it("git_reflog rejects option-like refs", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_reflog", { ref: "--all" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_reflog rejects overlong format", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_reflog", { format: "x".repeat(201) }),
			(err) => err.message.includes("too long"),
		);
	});
});
