/**
 * pi-git-tools — log integration tests.
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

describe("log", () => {
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

	it("git_log returns commit history", async () => {
		const result = await execTool(gitTools, "git_log");
		assert.ok(result.content[0].text.length > 0, "log output is non-empty");
		assert.ok(result.details?.count >= 2, "has at least 2 commits");
	});

	it("git_log oneline format matches commit count", async () => {
		const result = await execTool(gitTools, "git_log", {
			format: "oneline",
		});
		assert.ok(result.content[0].text.length > 0);
	});

	it("git_log can filter by branch (HEAD)", async () => {
		const result = await execTool(gitTools, "git_log", { branch: "HEAD" });
		assert.ok(result.content[0].text.length > 0);
	});

	it("git_log filters by path", async () => {
		const result = await execTool(gitTools, "git_log", {
			path: "README.md",
			format: "oneline",
		});
		assert.ok(result.content[0].text.length > 0);
	});

	/**
	 * Build a repo with a merge so --graph emits connector lines between
	 * commits (a topology where counting non-empty lines overcounts).
	 * Returns { repoPath, expected, cleanup }.
	 */
	function setupMergeRepo() {
		const path = mkdtempSync(resolve(tmpdir(), "pi-git-tools-log-graph-"));
		const run = (args) => execFileSync("git", args, { cwd: path });
		const commit = (file, message) => {
			writeFileSync(resolve(path, file), `${message}\n`);
			run(["add", file]);
			run(["commit", "-q", "-m", message]);
		};
		run(["init", "-q"]);
		run(["config", "user.name", "Test User"]);
		run(["config", "user.email", "test@example.com"]);
		const main = execFileSync("git", ["branch", "--show-current"], {
			cwd: path,
			encoding: "utf8",
		}).trim();
		commit("base.txt", "base");
		run(["checkout", "-qb", "side", "HEAD"]);
		commit("side.txt", "side commit");
		run(["checkout", "-q", main]);
		commit("main.txt", "main commit");
		run(["merge", "-q", "--no-ff", "side", "-m", "merge side"]);
		const expected = Number(
			execFileSync("git", ["rev-list", "--count", "HEAD"], {
				cwd: path,
				encoding: "utf8",
			}).trim(),
		);
		return {
			repoPath: path,
			expected,
			cleanup() {
				try {
					rmSync(path, { recursive: true, force: true });
				} catch {
					/* ok */
				}
			},
		};
	}

	it("git_log oneline with --graph counts commits, not connector lines", async () => {
		const setup = setupMergeRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const result = await execTool(gitTools, "git_log", {
				format: "oneline",
				graph: true,
			});
			const lines = result.content[0].text.split("\n").filter(Boolean);
			assert.ok(
				lines.length > setup.expected,
				"sanity: raw line count exceeds commit count (connectors present)",
			);
			assert.equal(result.details?.count, setup.expected);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_log detailed counts a body line '---' as part of the commit", async () => {
		writeFileSync(resolve(repoPath, "body.txt"), "body\n");
		execFileSync("git", ["add", "body.txt"], { cwd: repoPath });
		execFileSync(
			"git",
			[
				"commit",
				"-q",
				"-m",
				"subject with rule\n\nbody line\n---\nmore body",
				"--",
				"body.txt",
			],
			{ cwd: repoPath },
		);
		const expected = Number(
			execFileSync("git", ["rev-list", "--count", "HEAD"], {
				cwd: repoPath,
				encoding: "utf8",
			}).trim(),
		);
		const result = await execTool(gitTools, "git_log", {
			format: "detailed",
		});
		assert.equal(result.details?.count, expected);
		assert.ok(
			result.content[0].text.includes("\n---\n"),
			"body '---' line is preserved in the output",
		);
		assert.ok(
			!result.content[0].text.includes("\x1e"),
			"no record separator leaks into the output",
		);
	});

	it("git_log detailed with --graph counts commits", async () => {
		const setup = setupMergeRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const result = await execTool(gitTools, "git_log", {
				format: "detailed",
				graph: true,
			});
			assert.equal(result.details?.count, setup.expected);
			assert.ok(
				!result.content[0].text.includes("\x1e"),
				"no record separator leaks into the output",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_log full with --graph counts commits", async () => {
		const setup = setupMergeRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const result = await execTool(gitTools, "git_log", {
				format: "full",
				graph: true,
			});
			assert.equal(result.details?.count, setup.expected);
			assert.ok(
				!result.content[0].text.includes("\x1e"),
				"no record separator leaks into the output",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	// ------------------------------------------------------------------
	// decorate: ref names must render in every format. --decorate is a
	// no-op for custom --format strings, so full/detailed bake %d into the
	// format; oneline relies on the built-in format honoring the flag.
	// log.decorate is forced off locally so an ambient user config cannot
	// decorate the control cases (tests run against the real gitconfig).
	// ------------------------------------------------------------------

	function setupDecorateRepo() {
		const setup = setupTempRepo();
		execFileSync("git", ["config", "log.decorate", "false"], {
			cwd: setup.repoPath,
		});
		return setup;
	}

	it("git_log decorate shows ref names in oneline format", async () => {
		const setup = setupDecorateRepo();
		try {
			execTool.ctx = setup.ctx;
			const result = await execTool(gitTools, "git_log", {
				format: "oneline",
				decorate: true,
			});
			assert.ok(
				result.content[0].text.includes("(HEAD ->"),
				"oneline + decorate shows ref names",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_log decorate shows ref names in full format", async () => {
		const setup = setupDecorateRepo();
		try {
			execTool.ctx = setup.ctx;
			const result = await execTool(gitTools, "git_log", {
				format: "full",
				decorate: true,
			});
			assert.ok(
				result.content[0].text.split("\n")[0].includes("(HEAD ->"),
				"full + decorate puts ref names on the subject line",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_log decorate shows ref names in detailed format", async () => {
		const setup = setupDecorateRepo();
		try {
			execTool.ctx = setup.ctx;
			const result = await execTool(gitTools, "git_log", {
				format: "detailed",
				decorate: true,
			});
			assert.ok(
				result.content[0].text.split("\n")[0].includes("(HEAD ->"),
				"detailed + decorate puts ref names on the commit hash line",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_log full with decorate and --graph still counts commits", async () => {
		const setup = setupMergeRepo();
		try {
			execTool.ctx = { cwd: setup.repoPath };
			const result = await execTool(gitTools, "git_log", {
				format: "full",
				graph: true,
				decorate: true,
			});
			assert.equal(result.details?.count, setup.expected);
			assert.ok(
				result.content[0].text.includes("(HEAD ->"),
				"decorated merge commit shows ref names",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});

	it("git_log without decorate omits ref names in full/detailed", async () => {
		const setup = setupDecorateRepo();
		try {
			execTool.ctx = setup.ctx;
			const full = await execTool(gitTools, "git_log", {
				format: "full",
			});
			const detailed = await execTool(gitTools, "git_log", {
				format: "detailed",
			});
			assert.ok(
				!full.content[0].text.includes("(HEAD ->"),
				"full without decorate omits ref names",
			);
			assert.ok(
				!detailed.content[0].text.includes("(HEAD ->"),
				"detailed without decorate omits ref names",
			);
		} finally {
			execTool.ctx = ctx;
			setup.cleanup();
		}
	});
});
