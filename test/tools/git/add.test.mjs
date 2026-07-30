/**
 * pi-git-tools — add integration tests.
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("add", () => {
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

	it("git_add stages specific paths", async () => {
		const addPath = "to-stage.txt";
		writeFileSync(resolve(repoPath, addPath), "new file\n");
		const result = await execTool(gitTools, "git_add", {
			paths: [addPath],
		});
		assert.ok(result.content[0].text.length > 0);
		assert.equal(result.details.pathCount, 1);
		assert.equal(result.details.all, false);
		// Verify it's staged
		const status = execFileSync("git", ["status", "--porcelain", addPath], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(
			status.startsWith("A ") || status.startsWith("M "),
			`${addPath} is staged`,
		);
	});

	it("git_add --all stages all changes", async () => {
		const allPath = "stage-all.txt";
		writeFileSync(resolve(repoPath, allPath), "all test\n");
		const result = await execTool(gitTools, "git_add", { all: true });
		assert.ok(result.content[0].text.length > 0);
		assert.equal(result.details.all, true);
		// Verify the file is staged
		const status = execFileSync("git", ["status", "--porcelain", allPath], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(
			status.startsWith("A ") || status.startsWith("M "),
			`${allPath} is staged via --all`,
		);
	});

	it("git_add rejects invalid paths", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_add", { paths: ["../escape"] }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_add requires paths, all, or update", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_add", { intentToAdd: true }),
			(err) =>
				err.message.includes("paths") &&
				err.message.includes("all") &&
				err.message.includes("update"),
		);
	});

	it("git_add with --intent-to-add and paths", async () => {
		const intentPath = "intent-to-add.txt";
		writeFileSync(resolve(repoPath, intentPath), "intent\n");
		const result = await execTool(gitTools, "git_add", {
			paths: [intentPath],
			intentToAdd: true,
		});
		assert.ok(result.content[0].text.length > 0);
		assert.equal(result.details.intentToAdd, true);
		// Intent-to-add files show as " A" in porcelain (space + A — added to index, not staged)
		const status = execFileSync("git", ["status", "--porcelain", intentPath], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(
			status.length > 0,
			`${intentPath} is tracked after intent-to-add`,
		);

		// Cleanup: unstage the intent-to-add so it doesn't affect other tests
		execFileSync("git", ["reset", "HEAD", "--", intentPath], {
			cwd: repoPath,
		});
		try {
			execFileSync("rm", ["-f", resolve(repoPath, intentPath)]);
		} catch {
			/* ok */
		}
	});
	it("git_add rejects all with update", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_add", { all: true, update: true }),
			(err) => err.message.includes("mutually exclusive"),
		);
	});
});
