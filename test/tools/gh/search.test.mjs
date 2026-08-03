/**
 * pi-git-tools — gh_search validation tests.
 */
import { before, describe, it } from "node:test";
import { buildSearchArgs } from "../../../src/tools/gh/search.ts";
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

describe("buildSearchArgs", () => {
	it("marks the query as positional with '--' so a hyphen prefix is not a flag", () => {
		const args = buildSearchArgs("repos", "repo", "-topic:linux", 10);
		const sep = args.indexOf("--");
		assert.ok(sep !== -1, "expected a '--' separator");
		assert.deepEqual(args.slice(sep), ["--", "-topic:linux"]);
	});

	it("keeps all flags before the '--' separator", () => {
		const args = buildSearchArgs(
			"issues",
			"issue",
			"-label:bug",
			25,
			"created",
			"asc",
		);
		const sep = args.indexOf("--");
		assert.deepEqual(args.slice(0, sep), [
			"search",
			"issues",
			"--limit",
			"25",
			"--json",
			"number,title,state,author,repository,url,createdAt",
			"--sort",
			"created",
			"--order",
			"asc",
		]);
		assert.deepEqual(args.slice(sep), ["--", "-label:bug"]);
	});

	it("uses the same shape for plain queries", () => {
		const args = buildSearchArgs("repos", "repo", "react", 10);
		assert.deepEqual(args.slice(-2), ["--", "react"]);
	});

	it("omits --sort when it is best-match (gh default)", () => {
		const args = buildSearchArgs("repos", "repo", "react", 10, "best-match");
		assert.ok(!args.includes("--sort"));
	});
});
