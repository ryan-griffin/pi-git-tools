/**
 * pi-git-tools — pull integration tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execFileSync,
	execTool,
	resolve,
	setupTempRepo,
	tmpdir,
	writeFileSync,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("pull", () => {
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

	it("git_pull fetches and integrates upstream changes", async () => {
		const originPath = mkdtempSync(
			resolve(tmpdir(), "pi-git-tools-pull-origin-"),
		);
		const clonePath = mkdtempSync(
			resolve(tmpdir(), "pi-git-tools-pull-clone-"),
		);
		const branch = execFileSync("git", ["branch", "--show-current"], {
			cwd: repoPath,
			encoding: "utf8",
		}).trim();
		try {
			// Set up a bare origin seeded with the repo's history, then a
			// clone that will fall one commit behind.
			execFileSync("git", ["init", "--bare", "-q", originPath]);
			execFileSync("git", ["remote", "add", "origin", originPath], {
				cwd: repoPath,
			});
			execFileSync("git", ["push", "-q", "-u", "origin", branch], {
				cwd: repoPath,
			});
			execFileSync("git", ["clone", "-q", "-b", branch, originPath, clonePath]);

			// New upstream commit, pushed to origin.
			writeFileSync(resolve(repoPath, "upstream.txt"), "new content\n");
			execFileSync("git", ["add", "upstream.txt"], { cwd: repoPath });
			execFileSync("git", ["commit", "-q", "-m", "upstream change"], {
				cwd: repoPath,
			});
			execFileSync("git", ["push", "-q", "origin", branch], {
				cwd: repoPath,
			});

			// Pull in the clone.
			execTool.ctx = { cwd: clonePath };
			const result = await execTool(gitTools, "git_pull");
			assert.ok(result.content[0].text.length > 0, "pull produced output");
			const log = execFileSync("git", ["log", "--oneline", "-1"], {
				cwd: clonePath,
				encoding: "utf8",
			});
			assert.ok(log.includes("upstream change"), log);
		} finally {
			execTool.ctx = ctx;
			try {
				rmSync(originPath, { recursive: true, force: true });
			} catch {
				/* ok */
			}
			try {
				rmSync(clonePath, { recursive: true, force: true });
			} catch {
				/* ok */
			}
		}
	});
});
