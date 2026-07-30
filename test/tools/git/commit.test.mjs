/**
 * pi-git-tools — commit integration tests.
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

describe("commit", () => {
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

	it("git_commit creates a commit with paths", async () => {
		const commitFile = "commit-path.txt";
		writeFileSync(resolve(repoPath, commitFile), "commit paths test\n");
		const result = await execTool(gitTools, "git_commit", {
			message: "Test: commit with paths",
			paths: [commitFile],
		});
		assert.ok(result.details.success);
		assert.equal(result.details.message, "Test: commit with paths");
		const log = execFileSync("git", ["log", "-1", "--oneline"], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(
			log.includes("Test: commit with paths"),
			`commit appears in log: "${log}"`,
		);
	});

	it("git_add all + git_commit stages and commits tracked changes", async () => {
		const allFile = "commit-modern.txt";
		// Create and commit first so the file is tracked
		writeFileSync(resolve(repoPath, allFile), "initial content\n");
		execFileSync("git", ["add", allFile], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Initial modern-flow file"], {
			cwd: repoPath,
		});
		// Now modify it — stage explicitly with git_add, then commit.
		writeFileSync(resolve(repoPath, allFile), "commit modern flow test\n");
		const addResult = await execTool(gitTools, "git_add", { all: true });
		assert.ok(addResult.content[0].text.length > 0);
		const result = await execTool(gitTools, "git_commit", {
			message: "Test: explicit staging",
		});
		assert.ok(result.details.success);
		const log = execFileSync("git", ["log", "-1", "--oneline"], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(log.includes("Test: explicit staging"));
	});

	it("git_commit amend adds changes to the last commit", async () => {
		const amendFile = "amend.txt";
		writeFileSync(resolve(repoPath, amendFile), "amend test\n");
		execFileSync("git", ["add", amendFile], { cwd: repoPath });
		const result = await execTool(gitTools, "git_commit", {
			message: "Amended commit message",
			amend: true,
		});
		assert.ok(result.details.success);
		assert.ok(result.details.amend);
		const log = execFileSync("git", ["log", "-1", "--oneline"], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		assert.ok(log.includes("Amended commit message"));
	});
});
