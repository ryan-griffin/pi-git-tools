/**
 * pi-git-tools — gh_pr validation tests.
 */
import { before, describe, it } from "node:test";
import { assert, captureTools, execTool } from "../../helpers.mjs";

const { registerGhTools } = await import("../../../src/gh-tools.ts");

describe("gh_pr", () => {
	let ghTools;

	before(() => {
		ghTools = captureTools(registerGhTools);
	});

	it("gh tools are registered", () => {
		assert.ok(ghTools.has("gh_pr"), "gh_pr registered");
		assert.ok(ghTools.has("gh_issue"), "gh_issue registered");
		assert.ok(ghTools.has("gh_repo"), "gh_repo registered");
		assert.ok(ghTools.has("gh_search"), "gh_search registered");
		assert.ok(ghTools.has("gh_api"), "gh_api registered");
	});

	it("rejects non-integer PR number", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "view",
					repo: "test/repo",
					number: 1.5,
				}),
			(err) => err.message.includes("positive integer"),
		);
	});

	it("rejects negative issue number", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_issue", {
					action: "view",
					repo: "test/repo",
					number: -1,
				}),
			(err) => err.message.includes("positive integer"),
		);
	});

	it("rejects zero PR number", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "view",
					repo: "test/repo",
					number: 0,
				}),
			(err) => err.message.includes("positive integer"),
		);
	});

	it("accepts valid PR number 1", async () => {
		try {
			await execTool(ghTools, "gh_pr", {
				action: "view",
				repo: "test/repo",
				number: 1,
			});
		} catch (err) {
			assert.ok(
				!err.message.includes("positive integer"),
				"should not fail number validation",
			);
		}
	});

	it("gh_pr create requires title unless fill", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "create",
					repo: "test/repo",
				}),
			(err) => err.message.includes("title"),
		);
	});

	it("gh_pr create rejects fill with title", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "create",
					repo: "test/repo",
					fill: true,
					title: "x",
				}),
			(err) => err.message.includes("fill"),
		);
	});

	it("gh_pr edit requires at least one change", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "edit",
					repo: "test/repo",
					number: 1,
				}),
			(err) => err.message.includes("at least one change"),
		);
	});

	it("gh_pr edit rejects option-like base", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "edit",
					repo: "test/repo",
					number: 1,
					base: "--main",
					title: "x",
				}),
			(err) => err.message.includes("branch name"),
		);
	});

	it("gh_issue edit requires at least one change", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_issue", {
					action: "edit",
					repo: "test/repo",
					number: 1,
				}),
			(err) => err.message.includes("at least one change"),
		);
	});

	it("gh_issue edit rejects invalid number", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_issue", {
					action: "edit",
					repo: "test/repo",
					number: 0,
				}),
			(err) => err.message.includes("positive integer"),
		);
	});

	it("gh_pr rejects action-inapplicable params", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "list",
					repo: "test/repo",
					mergeMethod: "squash",
				}),
			(err) =>
				err.message.includes(
					"'mergeMethod' is only valid for action(s): merge",
				),
		);
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_pr", {
					action: "create",
					repo: "test/repo",
					title: "x",
					undo: true,
				}),
			(err) =>
				err.message.includes("'undo' is only valid for action(s): ready"),
		);
	});

	it("gh_issue rejects action-inapplicable params", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_issue", {
					action: "close",
					repo: "test/repo",
					number: 1,
					title: "rename me",
				}),
			(err) =>
				err.message.includes(
					"'title' is only valid for action(s): create, edit",
				),
		);
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_issue", {
					action: "create",
					repo: "test/repo",
					title: "x",
					state: "open",
				}),
			(err) =>
				err.message.includes("'state' is only valid for action(s): list"),
		);
	});
});
