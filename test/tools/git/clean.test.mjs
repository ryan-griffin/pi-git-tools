/**
 * pi-git-tools — clean integration tests.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("clean", () => {
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

	it("git_clean --dry-run shows what would be cleaned", async () => {
		const result = await execTool(gitTools, "git_clean", {
			dryRun: true,
			force: true,
		});
		const text = result.content[0].text;
		assert.ok(
			text.includes("untracked.txt") || !text.includes("nothing"),
			text,
		);
	});

	it("git_clean removes a specific untracked path", async () => {
		const cleanPath = "clean-me.txt";
		writeFileSync(resolve(repoPath, cleanPath), "delete me\n");
		assert.ok(
			readFileSync(resolve(repoPath, cleanPath), "utf-8").length > 0,
			"file exists before clean",
		);

		const result = await execTool(gitTools, "git_clean", {
			force: true,
			paths: [cleanPath],
		});
		assert.ok(result.content[0].text.length > 0);

		// File should be gone
		let exists = true;
		try {
			readFileSync(resolve(repoPath, cleanPath));
		} catch {
			exists = false;
		}
		assert.ok(!exists, `file ${cleanPath} was removed by clean`);
	});

	it("git_clean requires force even without flags", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_clean", {}),
			(err) =>
				err.message.includes("force=true") && err.message.includes("dryRun"),
		);
	});

	it("git_clean requires force with directories", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_clean", { directories: true }),
			(err) =>
				err.message.includes("force=true") && err.message.includes("dryRun"),
		);
	});

	it("git_clean allows dryRun without force", async () => {
		const result = await execTool(gitTools, "git_clean", { dryRun: true });
		assert.ok(result.content[0].text.length > 0);
	});
});
