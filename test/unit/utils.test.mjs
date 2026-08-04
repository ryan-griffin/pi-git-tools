/**
 * Unit tests for src/utils.ts — findRepoRoot, resolveCwd, run.
 *
 * Tests error handling paths and edge cases. Does NOT test execution
 * of real git commands (that's in the integration tests).
 *
 * Usage: node --test test/utils.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { withEnv } from "../helpers.mjs";

const { resolveCwd } = await import("../../src/utils.ts");

// ---------------------------------------------------------------------------
// resolveCwd
// ---------------------------------------------------------------------------
describe("resolveCwd", () => {
	it("returns the cwd when provided", () => {
		assert.equal(resolveCwd({ cwd: "/some/path" }), "/some/path");
	});

	it("returns undefined when no cwd provided", () => {
		assert.equal(resolveCwd({}), undefined);
	});

	it("returns undefined when ctx is undefined", () => {
		assert.equal(resolveCwd(undefined), undefined);
	});

	it("returns undefined for empty string cwd", () => {
		assert.equal(resolveCwd({ cwd: "" }), undefined);
	});

	it("preserves the value as-is (does not normalize)", () => {
		assert.equal(resolveCwd({ cwd: "." }), ".");
		assert.equal(resolveCwd({ cwd: "./relative" }), "./relative");
	});
});

// ---------------------------------------------------------------------------
// findRepoRoot — error cases only
// ---------------------------------------------------------------------------
describe("findRepoRoot error handling", () => {
	it("throws 'Not inside a git repository' in a non-repo dir", async () => {
		const tmpDir = mkdtempSync(resolve(tmpdir(), "pi-git-tools-test-"));
		try {
			const { findRepoRoot } = await import("../../src/utils.ts");
			await assert.rejects(() => findRepoRoot(tmpDir), {
				message: "Not inside a git repository.",
			});
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("throws from a non-existent dir", async () => {
		const { findRepoRoot } = await import("../../src/utils.ts");
		await assert.rejects(
			() => findRepoRoot("/nonexistent/path/for/sure"),
			(err) =>
				err.message.includes("git repository") ||
				err.message.includes("repo root") ||
				err.message.includes("not installed") ||
				err.message.includes("not in PATH"),
		);
	});

	it("propagates timeouts instead of wrapping them", async () => {
		const { findRepoRoot } = await import("../../src/utils.ts");
		await withEnv({ PI_GIT_TOOLS_TIMEOUT_MS: "1" }, () =>
			assert.rejects(
				() => findRepoRoot(),
				(err) => err.message.includes("timed out or was cancelled"),
			),
		);
	});
});

// ---------------------------------------------------------------------------
// findRepoRoot — success cases
// ---------------------------------------------------------------------------
describe("findRepoRoot success", () => {
	it("returns the repo root, preserving a trailing-space path", async () => {
		const { findRepoRoot } = await import("../../src/utils.ts");
		const base = mkdtempSync(resolve(tmpdir(), "pi-git-tools-test-"));
		const repoPath = resolve(base, "repo ");
		try {
			mkdirSync(repoPath, { recursive: true });
			execFileSync("git", ["init", "-q"], { cwd: repoPath });
			const root = await findRepoRoot(repoPath);
			assert.equal(root, repoPath);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// run — output whitespace handling
// ---------------------------------------------------------------------------
describe("run output whitespace handling", () => {
	it("strips exactly one trailing line terminator", async () => {
		const { run } = await import("../../src/utils.ts");
		assert.equal(await run("printf", ["abc\n"]), "abc");
		assert.equal(await run("printf", ["abc"]), "abc");
	});

	it("preserves trailing spaces on the last line", async () => {
		const { run } = await import("../../src/utils.ts");
		assert.equal(await run("printf", ["abc   "]), "abc   ");
		assert.equal(await run("printf", ["abc   \n"]), "abc   ");
	});

	it("preserves trailing tabs", async () => {
		const { run } = await import("../../src/utils.ts");
		assert.equal(await run("printf", ["abc\t\n"]), "abc\t");
	});

	it("keeps content blank lines (strips only the final terminator)", async () => {
		const { run } = await import("../../src/utils.ts");
		assert.equal(await run("printf", ["a\n\n"]), "a\n");
	});

	it("handles CRLF terminators and lone CR", async () => {
		const { run } = await import("../../src/utils.ts");
		assert.equal(await run("printf", ["abc\r\n"]), "abc");
		assert.equal(await run("printf", ["abc\r"]), "abc\r");
	});

	it("handles empty and newline-only output", async () => {
		const { run } = await import("../../src/utils.ts");
		assert.equal(await run("printf", [""]), "");
		assert.equal(await run("printf", ["\n"]), "");
	});

	it("stderr fallback preserves trailing spaces", async () => {
		const { run } = await import("../../src/utils.ts");
		assert.equal(await run("sh", ["-c", "printf 'x   ' >&2"]), "x   ");
	});
});

// ---------------------------------------------------------------------------
// run — env safety overrides
// ---------------------------------------------------------------------------
describe("run env safety overrides", () => {
	it("forces color.ui=never regardless of repo config", async () => {
		const { run } = await import("../../src/utils.ts");
		const base = mkdtempSync(resolve(tmpdir(), "pi-git-tools-test-"));
		try {
			const repoPath = resolve(base, "colorrepo");
			mkdirSync(repoPath, { recursive: true });
			execFileSync("git", ["init", "-q"], { cwd: repoPath });
			execFileSync("git", ["config", "color.ui", "always"], {
				cwd: repoPath,
			});
			// GIT_CONFIG_COUNT config outranks the repo's local config.
			assert.equal(await run("git", ["config", "color.ui"], repoPath), "never");

			// No ANSI escapes in output that would be colored under
			// color.ui=always (git branch lists the current branch in green).
			execFileSync("git", ["config", "user.name", "Test User"], {
				cwd: repoPath,
			});
			execFileSync("git", ["config", "user.email", "test@example.com"], {
				cwd: repoPath,
			});
			execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "c1"], {
				cwd: repoPath,
			});
			const branch = await run("git", ["branch", "-vv"], repoPath);
			assert.ok(
				!branch.includes("\u001b["),
				`branch output has no ANSI escapes, got: ${JSON.stringify(branch)}`,
			);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// run — error path tests
// ---------------------------------------------------------------------------
describe("run error handling", () => {
	it("throws when the binary is not found", async () => {
		const { run } = await import("../../src/utils.ts");
		await assert.rejects(
			() => run("this-command-definitely-does-not-exist-12345", []),
			{
				message: /(not found|enoent|spawn)/i,
			},
		);
	});

	it("throws with stderr content when command fails", async () => {
		const { run } = await import("../../src/utils.ts");
		await assert.rejects(
			() => run("git", ["status"], "/tmp"),
			(err) => err.message.includes("git repository") || err.message.length > 0,
		);
	});
});
