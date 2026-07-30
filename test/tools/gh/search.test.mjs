/**
 * pi-git-tools — gh_search validation tests.
 */
import { before, describe, it } from "node:test";
import { assert, captureTools, execTool } from "../../helpers.mjs";

const { registerGhTools } = await import("../../../src/gh-tools.ts");

describe("gh_search", () => {
	let ghTools;

	before(() => {
		ghTools = captureTools(registerGhTools);
	});

	it("rejects stars sort for issues", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_search", {
					type: "issues",
					query: "test",
					sort: "stars",
				}),
			(err) => err.message.includes("Sort"),
		);
	});

	it("rejects stars sort for code", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_search", {
					type: "code",
					query: "test",
					sort: "stars",
				}),
			(err) => err.message.includes("Sort") || err.message.includes("order"),
		);
	});

	it("rejects order for code", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_search", {
					type: "code",
					query: "test",
					order: "asc",
				}),
			(err) => err.message.includes("code search"),
		);
	});
});
