/**
 * pi-git-tools — gh_api validation tests.
 */
import { before, describe, it } from "node:test";
import { assert, captureTools, execTool } from "../../helpers.mjs";

const { registerGhTools } = await import("../../../src/gh-tools.ts");

describe("gh_api", () => {
	let ghTools;

	before(() => {
		ghTools = captureTools(registerGhTools);
	});

	it("gh_api is registered", () => {
		assert.ok(ghTools.has("gh_api"), "gh_api registered");
	});

	it("requires a path", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "" }),
			(err) => err.message.includes("path"),
		);
	});

	it("rejects paths not starting with /", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "repos/owner/repo" }),
			(err) => err.message.includes("start with '/'"),
		);
	});

	it("rejects paths with whitespace", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "/repos/own er/repo" }),
			(err) => err.message.includes("invalid characters"),
		);
	});

	it("rejects invalid methods", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "/user", method: "FETCH" }),
			(err) => err.message.includes("Invalid method"),
		);
	});

	it("rejects data on GET", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "/user", data: "{}" }),
			(err) => err.message.includes("not valid for GET"),
		);
	});

	it("rejects malformed JSON data", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_api", {
					path: "/repos/o/r",
					method: "POST",
					data: "{nope",
				}),
			(err) => err.message.includes("valid JSON"),
		);
	});
});
