/**
 * pi-git-tools — clone integration tests.
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

describe("clone", () => {
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

	it("git_clone validates remote URL", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_clone", { url: "bad||url" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_clone rejects option-like directory", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_clone", {
					url: "https://github.com/a/b.git",
					directory: "--malicious",
				}),
			{ name: "ValidationError" },
		);
	});

	it("git_clone rejects option-like filter", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_clone", {
					url: "https://github.com/a/b.git",
					filter: "--upload-pack=exploit",
				}),
			{ name: "ValidationError" },
		);
	});

	it("git_clone rejects control characters in directory", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_clone", {
					url: "https://github.com/a/b.git",
					directory: "a\u0000b",
				}),
			{ name: "ValidationError" },
		);
	});
});
