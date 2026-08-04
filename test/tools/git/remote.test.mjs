/**
 * pi-git-tools — remote integration tests.
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

describe("remote", () => {
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

	it("git_remote lists remotes (empty for test repo)", async () => {
		const result = await execTool(gitTools, "git_remote", {
			action: "list",
		});
		assert.ok(result.content[0].text.length > 0);
	});

	it("git_remote can add and remove a remote", async () => {
		const remoteName = "test-remote";
		// Add a remote pointing to the same repo
		const addResult = await execTool(gitTools, "git_remote", {
			action: "add",
			name: remoteName,
			url: repoPath,
		});
		assert.ok(addResult.content[0].text.includes(remoteName));

		// Verify it appears in the list
		const listResult = await execTool(gitTools, "git_remote", {
			action: "list",
		});
		assert.ok(
			listResult.content[0].text.includes(remoteName),
			`remote ${remoteName} in list`,
		);

		// Remove it
		const removeResult = await execTool(gitTools, "git_remote", {
			action: "remove",
			name: remoteName,
		});
		assert.ok(removeResult.content[0].text.includes(remoteName));
	});

	it("git_remote rejects action-inapplicable params", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_remote", {
					action: "list",
					url: "https://example.com/x.git",
				}),
			(err) =>
				err.message.includes("'url' is only valid for action(s): add, set-url"),
		);
	});
});
