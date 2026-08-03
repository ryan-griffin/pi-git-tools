/**
 * pi-git-tools — Shared test helpers.
 *
 * Provides temp repo creation, tool capture, and execution helpers
 * used by all per-tool test files.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export {
	assert,
	execFileSync,
	mkdirSync,
	resolve,
	rmSync,
	tmpdir,
	writeFileSync,
};

/**
 * Create a fresh git repo for tests.  Returns { repoPath, ctx }.
 */
export function setupTempRepo() {
	const repoPath = mkdtempSync(resolve(tmpdir(), "pi-git-tools-test-"));

	execFileSync("git", ["init", "-q"], { cwd: repoPath });
	execFileSync("git", ["config", "user.name", "Test User"], {
		cwd: repoPath,
	});
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: repoPath,
	});

	// Initial commit
	writeFileSync(resolve(repoPath, "README.md"), "# Test Repo\n");
	execFileSync("git", ["add", "README.md"], { cwd: repoPath });
	execFileSync("git", ["commit", "-q", "-m", "Initial commit"], {
		cwd: repoPath,
	});

	// Source files
	mkdirSync(resolve(repoPath, "src"), { recursive: true });
	writeFileSync(resolve(repoPath, "src/index.ts"), "export const x = 1;\n");
	writeFileSync(resolve(repoPath, "src/utils.ts"), "export const y = 2;\n");
	execFileSync("git", ["add", "src/"], { cwd: repoPath });
	execFileSync("git", ["commit", "-q", "-m", "Add src files"], {
		cwd: repoPath,
	});

	// A feature branch
	execFileSync("git", ["branch", "feature/test"], { cwd: repoPath });

	// Create dirty working tree state (some tests depend on it)
	writeFileSync(resolve(repoPath, "untracked.txt"), "I am untracked\n");
	writeFileSync(resolve(repoPath, "README.md"), "# Test Repo\n\nModified\n");
	writeFileSync(resolve(repoPath, "staged.txt"), "staged content\n");
	execFileSync("git", ["add", "staged.txt"], { cwd: repoPath });

	return {
		repoPath,
		ctx: { cwd: repoPath },
		cleanup() {
			try {
				rmSync(repoPath, { recursive: true, force: true });
			} catch {
				/* ok */
			}
		},
	};
}

/**
 * Create a repo with two bare remotes (origin, other) where the current
 * branch tracks `other`. Used to verify tools follow the branch's upstream
 * when no remote is given, and honor an explicit remote.
 * Returns { repoPath, originPath, otherPath, branch, cleanup }.
 */
export function setupMultiRemoteRepo() {
	const base = mkdtempSync(resolve(tmpdir(), "pi-git-tools-multi-"));
	const repoPath = resolve(base, "repo");
	const originPath = resolve(base, "origin.git");
	const otherPath = resolve(base, "other.git");

	execFileSync("git", ["init", "-q", repoPath]);
	execFileSync("git", ["config", "user.name", "Test User"], {
		cwd: repoPath,
	});
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: repoPath,
	});
	writeFileSync(resolve(repoPath, "a.txt"), "a\n");
	execFileSync("git", ["add", "a.txt"], { cwd: repoPath });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoPath });
	const branch = execFileSync("git", ["branch", "--show-current"], {
		cwd: repoPath,
		encoding: "utf8",
	}).trim();

	execFileSync("git", ["init", "--bare", "-q", originPath]);
	execFileSync("git", ["init", "--bare", "-q", otherPath]);
	execFileSync("git", ["remote", "add", "origin", originPath], {
		cwd: repoPath,
	});
	execFileSync("git", ["remote", "add", "other", otherPath], {
		cwd: repoPath,
	});
	execFileSync("git", ["push", "-q", "origin", branch], { cwd: repoPath });
	execFileSync("git", ["push", "-q", "other", branch], { cwd: repoPath });
	execFileSync(
		"git",
		["branch", "--set-upstream-to", `other/${branch}`, branch],
		{ cwd: repoPath },
	);

	return {
		repoPath,
		originPath,
		otherPath,
		branch,
		cleanup() {
			try {
				rmSync(base, { recursive: true, force: true });
			} catch {
				/* ok */
			}
		},
	};
}

/**
 * Advance a bare remote's branch with a new commit (via a scratch clone),
 * leaving the caller's repo remote-tracking refs stale. Returns the new
 * commit hash. Used by fetch/pull tests to put commits on remotes that the
 * repo under test has not seen yet.
 */
export function advanceRemote(barePath, branch, message) {
	const scratch = mkdtempSync(resolve(tmpdir(), "pi-git-tools-advance-"));
	try {
		const wc = resolve(scratch, "wc");
		execFileSync("git", ["clone", "-q", "-b", branch, barePath, wc]);
		execFileSync("git", ["config", "user.name", "Test User"], { cwd: wc });
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: wc,
		});
		writeFileSync(resolve(wc, "advance.txt"), `${message}\n`);
		execFileSync("git", ["add", "advance.txt"], { cwd: wc });
		execFileSync("git", ["commit", "-q", "-m", message], { cwd: wc });
		execFileSync("git", ["push", "-q", "origin", branch], { cwd: wc });
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: wc,
			encoding: "utf8",
		}).trim();
	} finally {
		try {
			rmSync(scratch, { recursive: true, force: true });
		} catch {
			/* ok */
		}
	}
}

/**
 * Capture tool registrations by mocking the pi ExtensionAPI.
 * Returns a Map of tool name → execute function.
 */
export function captureTools(registerFn) {
	const tools = new Map();
	registerFn({
		registerTool(config) {
			tools.set(config.name, {
				execute: config.execute,
				parameters: config.parameters,
			});
		},
	});
	return tools;
}

/**
 * Execute a tool by name with the given params.
 * Returns the tool result or throws.
 */
export async function execTool(tools, name, params = {}) {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Unknown tool: ${name}`);
	const signal = new AbortController().signal;
	return await tool.execute(
		"test-call",
		params,
		signal,
		undefined,
		execTool.ctx,
	);
}

/** Set the execution context for execTool. Call in your before() hook. */
execTool.ctx = undefined;
