/**
 * pi-git-tools — fetch integration tests.
 */
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	advanceRemote,
	assert,
	captureTools,
	execFileSync,
	execTool,
	setupMultiRemoteRepo,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("fetch", () => {
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

	it("git_fetch validates branch param", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_fetch", { branch: "branch;" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_fetch rejects empty strings instead of treating them as omitted", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_fetch", { remote: "" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_fetch rejects depth with unshallow", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_fetch", { depth: 1, unshallow: true }),
			(err) => err.message.includes("mutually exclusive"),
		);
	});

	it("git_fetch rejects mutually exclusive options", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_fetch", { tags: true, noTags: true }),
			(err) => err.message.includes("mutually exclusive"),
		);
	});

	it("git_fetch follows the branch's upstream when no remote is given", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const staleOrigin = execFileSync(
				"git",
				["rev-parse", `refs/remotes/origin/${setup.branch}`],
				{ cwd: setup.repoPath, encoding: "utf8" },
			).trim();
			const originHead = advanceRemote(
				setup.originPath,
				setup.branch,
				"origin commit",
			);
			const otherHead = advanceRemote(
				setup.otherPath,
				setup.branch,
				"other commit",
			);

			const result = await execTool(gitTools, "git_fetch");
			assert.equal(result.details.remote, "default");
			// The tracked remote 'other' was fetched...
			assert.equal(
				execFileSync(
					"git",
					["rev-parse", `refs/remotes/other/${setup.branch}`],
					{ cwd: setup.repoPath, encoding: "utf8" },
				).trim(),
				otherHead,
				"tracked remote 'other' should be fetched",
			);
			// ...and origin was not.
			assert.equal(
				execFileSync(
					"git",
					["rev-parse", `refs/remotes/origin/${setup.branch}`],
					{ cwd: setup.repoPath, encoding: "utf8" },
				).trim(),
				staleOrigin,
				"origin must not be fetched",
			);
			assert.notEqual(originHead, staleOrigin, "test setup sanity");
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_fetch honors an explicit remote", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const staleOrigin = execFileSync(
				"git",
				["rev-parse", `refs/remotes/origin/${setup.branch}`],
				{ cwd: setup.repoPath, encoding: "utf8" },
			).trim();
			advanceRemote(setup.originPath, setup.branch, "origin commit");
			const otherHead = advanceRemote(
				setup.otherPath,
				setup.branch,
				"other commit",
			);

			const result = await execTool(gitTools, "git_fetch", {
				remote: "other",
			});
			assert.equal(result.details.remote, "other");
			assert.equal(
				execFileSync(
					"git",
					["rev-parse", `refs/remotes/other/${setup.branch}`],
					{ cwd: setup.repoPath, encoding: "utf8" },
				).trim(),
				otherHead,
			);
			assert.equal(
				execFileSync(
					"git",
					["rev-parse", `refs/remotes/origin/${setup.branch}`],
					{ cwd: setup.repoPath, encoding: "utf8" },
				).trim(),
				staleOrigin,
				"origin must not be fetched",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_fetch --all fetches every remote without a remote argument", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const originHead = advanceRemote(
				setup.originPath,
				setup.branch,
				"origin commit",
			);
			const otherHead = advanceRemote(
				setup.otherPath,
				setup.branch,
				"other commit",
			);

			const result = await execTool(gitTools, "git_fetch", { all: true });
			assert.equal(result.details.remote, "all");
			assert.equal(
				execFileSync(
					"git",
					["rev-parse", `refs/remotes/origin/${setup.branch}`],
					{ cwd: setup.repoPath, encoding: "utf8" },
				).trim(),
				originHead,
			);
			assert.equal(
				execFileSync(
					"git",
					["rev-parse", `refs/remotes/other/${setup.branch}`],
					{ cwd: setup.repoPath, encoding: "utf8" },
				).trim(),
				otherHead,
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_fetch with only a branch defaults the remote to origin", async () => {
		const setup = setupMultiRemoteRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			// Put feature/x on origin, then drop the local tracking ref so the
			// fetch must actually come from origin.
			execFileSync(
				"git",
				["push", "-q", "origin", `${setup.branch}:feature/x`],
				{ cwd: setup.repoPath },
			);
			execFileSync(
				"git",
				["update-ref", "-d", "refs/remotes/origin/feature/x"],
				{ cwd: setup.repoPath },
			);

			const result = await execTool(gitTools, "git_fetch", {
				branch: "feature/x",
			});
			assert.equal(result.details.remote, "origin");
			assert.equal(result.details.branch, "feature/x");
			// The remote-tracking ref was re-created from origin...
			execFileSync(
				"git",
				["show-ref", "--verify", "--quiet", "refs/remotes/origin/feature/x"],
				{ cwd: setup.repoPath },
			);
			// ...and nothing was fetched from the tracked remote.
			assert.throws(() =>
				execFileSync(
					"git",
					["show-ref", "--verify", "--quiet", "refs/remotes/other/feature/x"],
					{ cwd: setup.repoPath },
				),
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});
});
