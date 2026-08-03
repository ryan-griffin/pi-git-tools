/**
 * pi-git-tools — push integration tests.
 */
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execFileSync,
	execTool,
	resolve,
	setupMultiRemoteRepo,
	setupTempRepo,
	writeFileSync,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("push", () => {
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

	it("git_push validates branch param", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_push", { branch: "branch;" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_push rejects empty strings instead of treating them as omitted", async () => {
		await assert.rejects(() => execTool(gitTools, "git_push", { branch: "" }), {
			name: "ValidationError",
		});
		await assert.rejects(() => execTool(gitTools, "git_push", { remote: "" }), {
			name: "ValidationError",
		});
	});

	it("git_push rejects mutually exclusive options", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_push", {
					force: true,
					forceWithLease: true,
				}),
			(err) => err.message.includes("both"),
		);
		await assert.rejects(
			() =>
				execTool(gitTools, "git_push", {
					deleteBranch: "old",
					branch: "main",
				}),
			(err) => err.message.includes("both"),
		);
	});

	it("git_push follows the branch's upstream when no remote is given", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const original = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: setup.repoPath,
				encoding: "utf8",
			}).trim();
			writeFileSync(resolve(setup.repoPath, "b.txt"), "b\n");
			execFileSync("git", ["add", "b.txt"], { cwd: setup.repoPath });
			execFileSync("git", ["commit", "-q", "-m", "local"], {
				cwd: setup.repoPath,
			});
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: setup.repoPath,
				encoding: "utf8",
			}).trim();

			const result = await execTool(gitTools, "git_push");
			assert.equal(result.details.remote, "default");
			// The commit lands on the tracked remote 'other'...
			assert.equal(
				execFileSync("git", ["rev-parse", `refs/heads/${setup.branch}`], {
					cwd: setup.otherPath,
					encoding: "utf8",
				}).trim(),
				head,
				"tracked remote 'other' should receive the commit",
			);
			// ...and NOT on origin.
			assert.equal(
				execFileSync("git", ["rev-parse", `refs/heads/${setup.branch}`], {
					cwd: setup.originPath,
					encoding: "utf8",
				}).trim(),
				original,
				"origin must not receive the commit",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_push honors an explicit remote", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const original = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: setup.repoPath,
				encoding: "utf8",
			}).trim();
			writeFileSync(resolve(setup.repoPath, "c.txt"), "c\n");
			execFileSync("git", ["add", "c.txt"], { cwd: setup.repoPath });
			execFileSync("git", ["commit", "-q", "-m", "to-other"], {
				cwd: setup.repoPath,
			});
			const head = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: setup.repoPath,
				encoding: "utf8",
			}).trim();

			const result = await execTool(gitTools, "git_push", {
				remote: "other",
			});
			assert.equal(result.details.remote, "other");
			assert.equal(
				execFileSync("git", ["rev-parse", `refs/heads/${setup.branch}`], {
					cwd: setup.otherPath,
					encoding: "utf8",
				}).trim(),
				head,
			);
			assert.equal(
				execFileSync("git", ["rev-parse", `refs/heads/${setup.branch}`], {
					cwd: setup.originPath,
					encoding: "utf8",
				}).trim(),
				original,
				"origin must not receive the commit",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_push with only a branch defaults the remote to origin", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			execFileSync("git", ["branch", "feature/x"], {
				cwd: setup.repoPath,
			});

			const result = await execTool(gitTools, "git_push", {
				branch: "feature/x",
			});
			assert.equal(result.details.remote, "origin");
			assert.equal(result.details.branch, "feature/x");
			// Pushed to origin...
			execFileSync(
				"git",
				["show-ref", "--verify", "--quiet", "refs/heads/feature/x"],
				{ cwd: setup.originPath },
			);
			// ...and not to the tracked remote.
			assert.throws(() =>
				execFileSync(
					"git",
					["show-ref", "--verify", "--quiet", "refs/heads/feature/x"],
					{ cwd: setup.otherPath },
				),
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_push deleteBranch without a remote defaults to origin", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			execFileSync(
				"git",
				["push", "-q", "origin", `${setup.branch}:feature/x`],
				{ cwd: setup.repoPath },
			);
			execFileSync(
				"git",
				["push", "-q", "other", `${setup.branch}:feature/x`],
				{ cwd: setup.repoPath },
			);

			const result = await execTool(gitTools, "git_push", {
				deleteBranch: "feature/x",
			});
			assert.equal(result.details.remote, "origin");
			assert.equal(result.details.deleteBranch, "feature/x");
			// Deleted from origin...
			assert.throws(() =>
				execFileSync(
					"git",
					["show-ref", "--verify", "--quiet", "refs/heads/feature/x"],
					{ cwd: setup.originPath },
				),
			);
			// ...and still present on the tracked remote.
			execFileSync(
				"git",
				["show-ref", "--verify", "--quiet", "refs/heads/feature/x"],
				{ cwd: setup.otherPath },
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_push fails with git's error when no upstream or remote is configured", async () => {
		// Bare push in a repo with no remotes and no upstream fails with git's
		// own error. Pinned to this message so the test discriminates: the
		// forced-origin variant produced "no upstream branch" in this setup.
		await assert.rejects(
			() => execTool(gitTools, "git_push"),
			(err) => /no configured push destination/i.test(err.message),
		);
	});
});
