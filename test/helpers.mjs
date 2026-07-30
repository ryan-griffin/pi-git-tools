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
