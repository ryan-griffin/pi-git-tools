/**
 * Unit tests for src/truncate.ts — the output-truncation wrapper.
 *
 * Verifies the wrapper contract: small results pass through byte-identical,
 * oversized results are truncated to pi's limits with the full output saved
 * to a temp file, error messages are capped, and session shutdown cleanup
 * removes temp files.
 *
 * Usage: node --test test/unit/truncate.test.mjs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { after, describe, it } from "node:test";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";

const {
	capErrorMessage,
	registerTool,
	registerTruncationCleanup,
	withOutputTruncation,
	writeTempOutput,
} = await import("../../src/truncate.ts");

const { CommandError } = await import("../../src/utils.ts");

/**
 * Temp dirs created by writeTempOutput during tests, removed by the after()
 * hook below — failure-safe, so an assertion error mid-test cannot leak
 * /tmp/pi-git-tools-out-* dirs.
 */
const tempOutputDirs = new Set();

function trackTempDir(path) {
	tempOutputDirs.add(path);
}

after(() => {
	for (const dir of tempOutputDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Already removed (e.g. by the shutdown-handler test).
		}
	}
	tempOutputDirs.clear();
});

/** Build a minimal ToolDefinition whose execute returns `result`. */
function makeDef(execute) {
	return {
		name: "test_tool",
		label: "Test Tool",
		description: "A test tool.",
		parameters: {},
		execute,
	};
}

function okResult(text, details = {}) {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

// ---------------------------------------------------------------------------
// withOutputTruncation — result passthrough
// ---------------------------------------------------------------------------
describe("withOutputTruncation", () => {
	it("passes small results through byte-identical", async () => {
		const def = makeDef(async () => okResult("hello world", { n: 42 }));
		const wrapped = withOutputTruncation(def);
		const result = await wrapped.execute("c", {}, undefined, undefined, {});
		assert.equal(result.content[0].text, "hello world");
		assert.deepEqual(result.details, { n: 42 });
	});

	it("forwards all execute arguments to the wrapped tool", async () => {
		const seen = {};
		const def = makeDef(async (toolCallId, params, signal, onUpdate, ctx) => {
			seen.toolCallId = toolCallId;
			seen.params = params;
			seen.signal = signal;
			seen.onUpdate = onUpdate;
			seen.ctx = ctx;
			return okResult("ok");
		});
		const signal = new AbortController().signal;
		const ctx = { cwd: "/tmp" };
		const wrapped = withOutputTruncation(def);
		await wrapped.execute("c1", { a: 1 }, signal, () => {}, ctx);
		assert.equal(seen.toolCallId, "c1");
		assert.deepEqual(seen.params, { a: 1 });
		assert.equal(seen.signal, signal);
		assert.equal(typeof seen.onUpdate, "function");
		assert.equal(seen.ctx, ctx);
	});

	it("truncates output over the line limit and saves the full output", async () => {
		const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
		const def = makeDef(async () => okResult(big, { original: true }));
		const wrapped = withOutputTruncation(def);
		const result = await wrapped.execute("c", {}, undefined, undefined, {});
		const text = result.content[0].text;

		assert.ok(text.includes("[Output truncated:"), "footer present");
		assert.ok(text.endsWith("]"), "footer is last");
		assert.ok(
			result.details.truncation.outputLines <= DEFAULT_MAX_LINES,
			"truncated content respects line limit",
		);
		assert.ok(
			Buffer.byteLength(text, "utf8") <= DEFAULT_MAX_BYTES + 1024,
			"truncated content respects byte limit (footer allowance)",
		);
		assert.equal(result.details.truncation.truncated, true);
		assert.equal(result.details.truncation.totalLines, 2500);
		assert.equal(result.details.truncation.truncatedBy, "lines");
		assert.equal(result.details.original, true, "original details kept");

		const fullPath = result.details.fullOutputPath;
		assert.ok(fullPath, "fullOutputPath present");
		assert.ok(existsSync(fullPath), "full output file exists");
		assert.equal(
			readFileSync(fullPath, "utf8"),
			big,
			"saved file contains the full output",
		);
		trackTempDir(dirname(fullPath));
	});

	it("truncates a single oversized line by bytes", async () => {
		const big = "x".repeat(100 * 1024);
		const def = makeDef(async () => okResult(big));
		const wrapped = withOutputTruncation(def);
		const result = await wrapped.execute("c", {}, undefined, undefined, {});
		const text = result.content[0].text;

		assert.ok(text.includes("[Output truncated:"), "footer present");
		assert.equal(result.details.truncation.truncatedBy, "bytes");
		assert.equal(
			result.details.truncation.firstLineExceedsLimit,
			true,
			"oversized single line yields empty content (pinned host behavior)",
		);
		assert.ok(
			text.startsWith("\n\n[Output truncated:"),
			"content is footer-only for an oversized single line",
		);
		assert.ok(result.details.fullOutputPath, "full output path present");
		assert.equal(
			readFileSync(result.details.fullOutputPath, "utf8"),
			big,
			"full single line saved",
		);
		trackTempDir(dirname(result.details.fullOutputPath));
	});

	it("appends the truncation policy to the description once", async () => {
		const def = makeDef(async () => okResult("ok"));
		const wrapped = withOutputTruncation(def);
		assert.ok(
			wrapped.description.includes("whichever is hit first"),
			"policy in description",
		);
		assert.ok(
			wrapped.description.includes("details.fullOutputPath"),
			"file hint in description",
		);
		// Idempotent: wrapping again must not duplicate the suffix.
		const double = withOutputTruncation(wrapped);
		assert.equal(double.description, wrapped.description);
	});
});

// ---------------------------------------------------------------------------
// capErrorMessage
// ---------------------------------------------------------------------------
describe("capErrorMessage", () => {
	it("passes small errors through unchanged", () => {
		const err = new Error("Not inside a git repository.");
		assert.equal(capErrorMessage(err), err);
		assert.equal(err.message, "Not inside a git repository.");
	});

	it("caps oversized error messages tail-first with a footer", () => {
		const err = new Error(`head\n${"y".repeat(2_000_000)}\nfatal: real error`);
		capErrorMessage(err);
		assert.ok(
			Buffer.byteLength(err.message, "utf8") <= DEFAULT_MAX_BYTES + 256,
			"message within byte limit",
		);
		assert.ok(err.message.includes("[Output truncated:"), "footer present");
		assert.ok(
			err.message.includes("fatal: real error"),
			"tail (fatal line) survives",
		);
	});

	it("does not append a false footer at the exact line-limit boundary", () => {
		// 2000 lines with a trailing newline: a naive split("\n") count would
		// say 2001 lines, but the host's line counting pops the trailing empty
		// element — nothing is actually dropped, so no footer may appear.
		const msg =
			Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n") + "\n";
		const err = new Error(msg);
		capErrorMessage(err);
		assert.equal(err.message, msg, "boundary message untouched");
		assert.ok(!err.message.includes("[Output truncated:"), "no false footer");
	});

	it("preserves CommandError stdout/stderr/exitCode while capping the message", () => {
		const err = new CommandError(
			`head\n${"y".repeat(2_000_000)}\nfatal: real error`,
			{ exitCode: 128, stdout: "machine output", stderr: "raw stderr" },
		);
		capErrorMessage(err);
		assert.ok(err.message.includes("[Output truncated:"), "message capped");
		assert.ok(err.message.includes("fatal: real error"), "tail survives");
		assert.equal(err.exitCode, 128, "exitCode preserved");
		assert.equal(err.stdout, "machine output", "stdout preserved");
		assert.equal(err.stderr, "raw stderr", "stderr preserved");
	});

	it("returns non-Error values as-is", () => {
		assert.equal(capErrorMessage("boom"), "boom");
		assert.equal(capErrorMessage(undefined), undefined);
	});
});

// ---------------------------------------------------------------------------
// registerTool
// ---------------------------------------------------------------------------
describe("registerTool", () => {
	it("registers the wrapped definition", () => {
		const def = makeDef(async () => okResult("ok"));
		let registered;
		registerTool(
			{
				registerTool: (d) => {
					registered = d;
				},
			},
			def,
		);
		assert.notEqual(registered.execute, def.execute, "execute is wrapped");
		assert.ok(
			registered.description.includes("whichever is hit first"),
			"description augmented",
		);
		assert.equal(registered.name, "test_tool");
	});
});

// ---------------------------------------------------------------------------
// writeTempOutput + registerTruncationCleanup
// ---------------------------------------------------------------------------
describe("writeTempOutput / registerTruncationCleanup", () => {
	it("writes to a unique temp dir per call", () => {
		const p1 = writeTempOutput("one");
		const p2 = writeTempOutput("two");
		assert.notEqual(dirname(p1), dirname(p2), "distinct dirs");
		assert.equal(readFileSync(p1, "utf8"), "one");
		assert.equal(readFileSync(p2, "utf8"), "two");
		trackTempDir(dirname(p1));
		trackTempDir(dirname(p2));
	});

	it("writes temp output files with private permissions", () => {
		const p = writeTempOutput("secret");
		trackTempDir(dirname(p));
		assert.equal(statSync(p).mode & 0o777, 0o600, "file is 0600");
		assert.equal(statSync(dirname(p)).mode & 0o777, 0o700, "dir is 0700");
	});

	it("removes temp output dirs at session shutdown", async () => {
		let shutdownHandler;
		const mockPi = {
			on: (event, handler) => {
				if (event === "session_shutdown") shutdownHandler = handler;
			},
		};
		registerTruncationCleanup(mockPi);
		assert.equal(typeof shutdownHandler, "function");

		const p1 = writeTempOutput("aaa");
		const p2 = writeTempOutput("bbb");
		assert.ok(existsSync(p1));
		assert.ok(existsSync(p2));

		await shutdownHandler();
		assert.ok(!existsSync(p1), "temp output removed at shutdown");
		assert.ok(!existsSync(p2), "second temp output removed at shutdown");
	});
});
