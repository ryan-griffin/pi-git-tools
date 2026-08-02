/**
 * pi-git-tools — output truncation integration tests.
 *
 * Proves the truncation wrapper is active on a real registered tool and
 * that tools which parse their output (git_diff numstat counts) still see
 * the FULL output — truncation only touches the result text.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execFileSync,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { register: registerDiff } = await import(
	"../../../src/tools/git/diff.ts"
);

describe("truncation", () => {
	let ctx;
	let repoPath;
	let diffTools;

	/** Full-output temp dirs, removed failure-safely even when assertions throw. */
	const tempOutputDirs = new Set();
	function trackTempDir(path) {
		tempOutputDirs.add(path);
	}

	before(() => {
		const setup = setupTempRepo();
		repoPath = setup.repoPath;
		ctx = setup.ctx;
		execTool.ctx = ctx;
		diffTools = captureTools(registerDiff);
	});

	after(() => {
		for (const dir of tempOutputDirs) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				/* ok */
			}
		}
		tempOutputDirs.clear();
		try {
			rmSync(repoPath, { recursive: true, force: true });
		} catch {
			/* ok */
		}
	});

	it("git_diff truncates oversized output and saves the full diff", async () => {
		// A 2500-line addition exceeds the 2000-line result limit (and stays
		// under the 50KB byte limit, so the line limit is what triggers).
		const lines = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join(
			"\n",
		);
		writeFileSync(resolve(repoPath, "big.txt"), `${lines}\n`);
		execFileSync("git", ["add", "big.txt"], { cwd: repoPath });

		const result = await execTool(diffTools, "git_diff", {
			staged: true,
			path: "big.txt",
		});
		const text = result.content[0].text;

		assert.ok(text.includes("[Output truncated:"), "footer present");
		assert.ok(text.endsWith("]"), "footer is last");
		assert.equal(result.details?.truncation?.truncated, true);
		assert.ok(
			result.details.truncation.totalLines > 2000,
			"full output exceeded the line limit",
		);

		// The full diff is saved for the model to read.
		const fullPath = result.details.fullOutputPath;
		assert.ok(fullPath, "fullOutputPath present");
		const saved = readFileSync(fullPath, "utf8");
		const expected = execFileSync(
			"git",
			["diff", "--staged", "--no-color", "--", "big.txt"],
			{ cwd: repoPath, encoding: "utf8" },
		).trimEnd();
		assert.equal(saved, expected, "saved file equals the full diff");

		// Parsing happened on the FULL output before truncation.
		assert.equal(result.details?.files, 1, "numstat file count accurate");
		assert.equal(
			result.details?.insertions,
			2500,
			"numstat insertions accurate on truncated result",
		);

		trackTempDir(dirname(fullPath));
	});

	it("git_diff small output passes through untruncated", async () => {
		const result = await execTool(diffTools, "git_diff", {});
		const text = result.content[0].text;
		assert.ok(!text.includes("[Output truncated:"), "no footer");
		assert.equal(result.details?.truncation, undefined, "no truncation");
		assert.equal(result.details?.fullOutputPath, undefined, "no temp file");
	});

	it("git_diff truncates by bytes for an oversized single line", async () => {
		// One ~100KB line: well under the line limit, well over the byte
		// limit — pins the byte path (and firstLineExceedsLimit) on a real
		// tool, not just on the wrapper unit test.
		writeFileSync(resolve(repoPath, "huge.txt"), `${"x".repeat(100 * 1024)}\n`);
		execFileSync("git", ["add", "huge.txt"], { cwd: repoPath });

		const result = await execTool(diffTools, "git_diff", {
			staged: true,
			path: "huge.txt",
		});
		const text = result.content[0].text;

		assert.ok(text.includes("[Output truncated:"), "footer present");
		assert.equal(result.details?.truncation?.truncatedBy, "bytes");
		// Diff header lines survive; the single oversized line does not
		// (truncateHead breaks at the first line that would exceed the
		// byte budget — firstLineExceedsLimit is only set when the FIRST
		// line is oversized, which the unit test pins).
		assert.ok(text.includes("diff --git"), "header kept");
		assert.ok(
			!text.includes("x".repeat(1000)),
			"oversized line not in truncated result",
		);
		assert.ok(
			result.details.truncation.outputLines < 10,
			"only diff header lines remain",
		);

		const fullPath = result.details.fullOutputPath;
		assert.ok(fullPath, "fullOutputPath present");
		const saved = readFileSync(fullPath, "utf8");
		const expected = execFileSync(
			"git",
			["diff", "--staged", "--no-color", "--", "huge.txt"],
			{ cwd: repoPath, encoding: "utf8" },
		).trimEnd();
		assert.equal(saved, expected, "saved file equals the full diff");

		// Parsing still happens on the FULL output before truncation.
		assert.equal(result.details?.files, 1, "numstat file count accurate");
		assert.equal(
			result.details?.insertions,
			1,
			"numstat insertions accurate on truncated result",
		);

		trackTempDir(dirname(fullPath));
	});
});
