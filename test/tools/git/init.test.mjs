/**
 * pi-git-tools — init integration tests.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execFileSync,
	execTool,
	resolve,
	tmpdir,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("init", () => {
	let gitTools;

	before(() => {
		execTool.ctx = undefined;
		gitTools = captureTools(registerGitTools);
	});

	after(() => {
		execTool.ctx = undefined;
	});

	/** Run a command inside a fresh empty temp directory. */
	async function withTempDir(fn) {
		const dir = mkdtempSync(resolve(tmpdir(), "pi-git-tools-init-"));
		try {
			execTool.ctx = { cwd: dir };
			return await fn(dir);
		} finally {
			execTool.ctx = undefined;
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				/* ok */
			}
		}
	}

	it("git_init rejects option-like directory", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_init", { directory: "--evil" }),
			{ name: "ValidationError" },
		);
	});

	it("git_init rejects control characters in directory", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_init", { directory: "a\u0000b" }),
			{ name: "ValidationError" },
		);
	});

	it("git_init rejects option-like initial branch", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_init", { initialBranch: "-x" }),
			{ name: "ValidationError" },
		);
	});

	it("git_init rejects invalid initial branch names", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_init", { initialBranch: "a..b" }),
			{ name: "ValidationError" },
		);
	});

	it("git_init creates a repository in the working directory", async () => {
		await withTempDir(async (dir) => {
			const result = await execTool(gitTools, "git_init");
			assert.ok(existsSync(resolve(dir, ".git")), ".git exists");
			assert.equal(result.details.directory, dir);
			const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
				cwd: dir,
				encoding: "utf8",
			}).trim();
			assert.equal(root, dir);
		});
	});

	it("git_init initializes a target directory", async () => {
		await withTempDir(async (dir) => {
			await execTool(gitTools, "git_init", { directory: "project" });
			assert.ok(
				existsSync(resolve(dir, "project", ".git")),
				"project/.git exists",
			);
		});
	});

	it("git_init creates a bare repository", async () => {
		await withTempDir(async (dir) => {
			await execTool(gitTools, "git_init", { bare: true });
			const isBare = execFileSync(
				"git",
				["rev-parse", "--is-bare-repository"],
				{ cwd: dir, encoding: "utf8" },
			).trim();
			assert.equal(isBare, "true");
		});
	});

	it("git_init sets the initial branch", async () => {
		await withTempDir(async (dir) => {
			await execTool(gitTools, "git_init", { initialBranch: "trunk" });
			const branch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
				cwd: dir,
				encoding: "utf8",
			}).trim();
			assert.equal(branch, "trunk");
		});
	});

	it("git_init supports sha256 object format", async () => {
		await withTempDir(async (dir) => {
			await execTool(gitTools, "git_init", { objectFormat: "sha256" });
			const format = execFileSync(
				"git",
				["rev-parse", "--show-object-format"],
				{ cwd: dir, encoding: "utf8" },
			).trim();
			assert.equal(format, "sha256");
		});
	});

	it("git_init supports reftable ref format (git >= 2.45)", async (t) => {
		const version = execFileSync("git", ["--version"], {
			encoding: "utf8",
		});
		const match = version.match(/git version (\d+)\.(\d+)/);
		if (
			!match ||
			Number(match[1]) < 2 ||
			(Number(match[1]) === 2 && Number(match[2]) < 45)
		) {
			t.skip("reftable requires git >= 2.45");
			return;
		}
		await withTempDir(async (dir) => {
			await execTool(gitTools, "git_init", { refFormat: "reftable" });
			const refFormat = execFileSync(
				"git",
				["rev-parse", "--show-ref-format"],
				{ cwd: dir, encoding: "utf8" },
			).trim();
			assert.equal(refFormat, "reftable");
		});
	});
});
