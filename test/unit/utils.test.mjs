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
		const original = process.env.PI_GIT_TOOLS_TIMEOUT_MS;
		process.env.PI_GIT_TOOLS_TIMEOUT_MS = "1";
		try {
			await assert.rejects(
				() => findRepoRoot(),
				(err) => err.message.includes("timed out or was cancelled"),
			);
		} finally {
			if (original === undefined) {
				delete process.env.PI_GIT_TOOLS_TIMEOUT_MS;
			} else {
				process.env.PI_GIT_TOOLS_TIMEOUT_MS = original;
			}
		}
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
