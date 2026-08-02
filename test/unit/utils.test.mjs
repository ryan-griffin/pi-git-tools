/**
 * Unit tests for src/utils.ts — findRepoRoot, resolveCwd, run.
 *
 * Tests error handling paths and edge cases. Does NOT test execution
 * of real git commands (that's in the integration tests).
 *
 * Usage: node --test test/utils.test.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const { resolveCwd } = await import("../../src/utils.ts");
const { withOutputLimits } = await import("../../src/utils.ts");

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
});

// ---------------------------------------------------------------------------
// withOutputLimits
// ---------------------------------------------------------------------------
describe("withOutputLimits", () => {
	function registerTool(execute) {
		const registered = [];
		const boundedPi = withOutputLimits({
			registerTool(definition) {
				registered.push(definition);
			},
		});
		boundedPi.registerTool({
			name: "test-output",
			label: "Test output",
			description: "A test tool.",
			parameters: {},
			execute,
		});
		return registered[0];
	}

	it("bounds oversized final output and explains what was omitted", async () => {
		const tool = registerTool(async () => ({
			content: [
				{
					type: "text",
					text: Array.from({ length: 2_100 }, (_, i) => `line-${i}`).join("\n"),
				},
			],
			details: {},
		}));
		const result = await tool.execute("call", {}, undefined, undefined, {});
		const text = result.content[0].text;
		assert.ok(text.includes("line-0"));
		assert.ok(text.includes("Output truncated"));
		assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
		assert.ok(text.split("\n").length <= 2_000);
		assert.match(tool.description, /2,000 lines|2000 lines/);
	});

	it("bounds UTF-8 output without splitting characters", async () => {
		const tool = registerTool(async () => ({
			content: [
				{
					type: "text",
					text: Array.from({ length: 1_100 }, () => "😀".repeat(20)).join("\n"),
				},
			],
			details: {},
		}));
		const result = await tool.execute("call", {}, undefined, undefined, {});
		const text = result.content[0].text;
		assert.ok(text.includes("😀"));
		assert.ok(text.includes("Output truncated"));
		assert.ok(!text.includes("�"));
		assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
		assert.ok(text.split("\n").length <= 2_000);
	});

	it("bounds every partial update while preserving the final result", async () => {
		const updates = [];
		const final = {
			content: [{ type: "text", text: "done" }],
			details: { ok: true },
		};
		const tool = registerTool(async (_id, _params, _signal, onUpdate) => {
			onUpdate({
				content: [
					{
						type: "text",
						text: Array.from({ length: 2_100 }, (_, i) => `partial-${i}`).join(
							"\n",
						),
					},
				],
				details: { phase: "working" },
			});
			return final;
		});
		const result = await tool.execute(
			"call",
			{},
			undefined,
			(update) => {
				updates.push(update);
			},
			{},
		);
		assert.equal(result, final);
		assert.equal(updates.length, 1);
		const text = updates[0].content[0].text;
		assert.ok(text.includes("Output truncated"));
		assert.ok(Buffer.byteLength(text, "utf8") <= 50 * 1024);
		assert.ok(text.split("\n").length <= 2_000);
	});

	it("bounds thrown errors without converting failures to success", async () => {
		const thrown = new Error(
			Array.from({ length: 2_100 }, (_, i) => `failure-${i}`).join("\n"),
		);
		thrown.code = "COMMAND_FAILED";
		const tool = registerTool(async () => {
			throw thrown;
		});
		await assert.rejects(
			() => tool.execute("call", {}, undefined, undefined, {}),
			(err) => {
				assert.equal(err, thrown);
				assert.equal(err.code, "COMMAND_FAILED");
				assert.ok(err.message.includes("Output truncated"));
				assert.ok(Buffer.byteLength(err.message, "utf8") <= 50 * 1024);
				assert.ok(err.message.split("\n").length <= 2_000);
				return true;
			},
		);
	});

	it("preserves non-oversized result identity and content", async () => {
		const result = {
			content: [{ type: "text", text: "small" }],
			details: { ok: true },
		};
		const tool = registerTool(async () => result);
		assert.equal(
			await tool.execute("call", {}, undefined, undefined, {}),
			result,
		);
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
