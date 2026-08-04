/**
 * pi-git-tools — tag integration tests.
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

describe("tag", () => {
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

	it("git_tag can create and delete a tag", async () => {
		const createResult = await execTool(gitTools, "git_tag", {
			action: "create",
			name: "test-tag-v1",
		});
		assert.ok(createResult.content[0].text.includes("test-tag-v1"));

		const deleteResult = await execTool(gitTools, "git_tag", {
			action: "delete",
			name: "test-tag-v1",
		});
		assert.ok(deleteResult.content[0].text.includes("test-tag-v1"));
	});

	it("git_tag can create an annotated tag with a message", async () => {
		const tagName = "test-annotated-v1";
		const tagMessage = "Release v1.0.0";
		const result = await execTool(gitTools, "git_tag", {
			action: "create",
			name: tagName,
			message: tagMessage,
		});
		assert.ok(result.content[0].text.includes(tagName));
		assert.equal(result.details.annotated, true);

		// Verify the tag object exists and contains the annotation message
		const tagInfo = execFileSync("git", ["tag", "-n99", "-l", tagName], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(
			tagInfo.includes(tagMessage),
			`annotated tag contains message, got: "${tagInfo.trim()}"`,
		);

		// Cleanup
		execFileSync("git", ["tag", "-d", tagName], { cwd: repoPath });
	});

	it("git_tag sign without message throws", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_tag", {
					action: "create",
					name: "signed-tag",
					sign: true,
				}),
			(err) => err.message.includes("message"),
		);
	});

	it("git_tag rejects action-inapplicable params", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_tag", {
					action: "list",
					name: "v1",
				}),
			(err) =>
				err.message.includes(
					"'name' is only valid for action(s): create, delete, verify (got action='list')",
				),
		);
		await assert.rejects(
			() =>
				execTool(gitTools, "git_tag", {
					action: "create",
					name: "v1",
					listPattern: "v*",
				}),
			(err) =>
				err.message.includes("'listPattern' is only valid for action(s): list"),
		);
	});
});
