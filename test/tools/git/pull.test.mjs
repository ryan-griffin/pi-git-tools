/**
 * pi-git-tools — pull integration tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	advanceRemote,
	assert,
	captureTools,
	execFileSync,
	execTool,
	resolve,
	setupMultiRemoteRepo,
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
			assert.equal(result.details.remote, "default");
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

	it("git_pull rejects empty strings instead of treating them as omitted", async () => {
		await assert.rejects(() => execTool(gitTools, "git_pull", { branch: "" }), {
			name: "ValidationError",
		});
	});

	it("git_pull follows the branch's upstream by default", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const otherHead = advanceRemote(
				setup.otherPath,
				setup.branch,
				"other commit",
			);

			// The branch tracks 'other', so a bare pull integrates other's
			// commit — git-native upstream behavior, no origin assumption.
			const result = await execTool(gitTools, "git_pull");
			assert.equal(result.details.remote, "default");
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: setup.repoPath,
				encoding: "utf8",
			}).trim();
			assert.equal(head, otherHead, "HEAD should be other's commit");
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_pull with explicit remote and branch pulls from that remote", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const originHead = advanceRemote(
				setup.originPath,
				setup.branch,
				"origin commit",
			);

			// The branch tracks 'other', so an explicit remote alone makes git
			// ask for a branch — pass both to target origin.
			const result = await execTool(gitTools, "git_pull", {
				remote: "origin",
				branch: setup.branch,
			});
			assert.equal(result.details.remote, "origin");
			assert.equal(result.details.branch, setup.branch);
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: setup.repoPath,
				encoding: "utf8",
			}).trim();
			assert.equal(head, originHead, "HEAD should be origin's commit");
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_pull with only a branch defaults the remote to origin", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const originHead = advanceRemote(
				setup.originPath,
				setup.branch,
				"origin commit",
			);

			const result = await execTool(gitTools, "git_pull", {
				branch: setup.branch,
			});
			assert.equal(result.details.remote, "origin");
			assert.equal(result.details.branch, setup.branch);
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: setup.repoPath,
				encoding: "utf8",
			}).trim();
			assert.equal(head, originHead, "HEAD should be origin's commit");
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});
});
