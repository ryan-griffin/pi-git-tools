/**
 * pi-git-tools — git_apply integration tests.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("apply", () => {
	let repoPath;
	let gitTools;

	before(() => {
		const setup = setupTempRepo();
		repoPath = setup.repoPath;
		execTool.ctx = setup.ctx;
		gitTools = captureTools(registerGitTools);
	});

	after(() => {
		try {
			rmSync(repoPath, { recursive: true, force: true });
		} catch {
			/* ok */
		}
	});

	function makePatch(target, oldLine, newLine) {
		return `${[
			`diff --git a/${target} b/${target}`,
			`index 1111111..2222222 100644`,
			`--- a/${target}`,
			`+++ b/${target}`,
			`@@ -1 +1 @@`,
			`-${oldLine}`,
			`+${newLine}`,
		].join("\n")}\n`;
	}

	it("git_apply requires a patch", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_apply", { patch: "" }),
			(err) => err.message.includes("patch"),
		);
	});

	it("git_apply enforces the cap in UTF-8 bytes, not UTF-16 code units", async () => {
		const cap = 10 * 1024 * 1024;
		// 3.5M CJK chars: ~10 MB of UTF-8, but only 3.5M UTF-16 code units —
		// under the old .length-based check, over the advertised byte cap.
		const multibyte = "汉".repeat(3_500_000);
		assert.ok(multibyte.length < cap, "length under cap");
		assert.ok(Buffer.byteLength(multibyte, "utf8") > cap, "bytes over cap");
		await assert.rejects(
			() => execTool(gitTools, "git_apply", { patch: multibyte }),
			(err) => /exceeds.*cap/.test(err.message),
		);
	});

	it("git_apply applies a patch and check dry-runs", async () => {
		const target = "apply-me.txt";
		writeFileSync(resolve(repoPath, target), "line one\n");
		execFileSync("git", ["add", target], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add apply-me.txt"], {
			cwd: repoPath,
		});

		const patch = makePatch(target, "line one", "line one changed");

		// Dry run first — nothing should change
		const check = await execTool(gitTools, "git_apply", {
			patch,
			check: true,
		});
		assert.equal(check.details.action, "check");
		assert.equal(
			readFileSync(resolve(repoPath, target), "utf-8"),
			"line one\n",
			"check changed nothing",
		);

		// Real apply
		const result = await execTool(gitTools, "git_apply", { patch });
		assert.ok(result.details.action === "apply", "applied");
		assert.equal(
			readFileSync(resolve(repoPath, target), "utf-8"),
			"line one changed\n",
			"patch applied",
		);
	});

	it("git_apply reverse undoes a change", async () => {
		const target = "reverse-me.txt";
		writeFileSync(resolve(repoPath, target), "before\n");
		execFileSync("git", ["add", target], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add reverse-me.txt"], {
			cwd: repoPath,
		});
		writeFileSync(resolve(repoPath, target), "after\n");

		// Reverse-applying the patch should restore the original content
		const patch = makePatch(target, "before", "after");
		await execTool(gitTools, "git_apply", { patch, reverse: true });
		assert.equal(
			readFileSync(resolve(repoPath, target), "utf-8"),
			"before\n",
			"reverse applied",
		);
	});

	it("git_apply rejects stale patches without 3way", async () => {
		const target = "stale.txt";
		writeFileSync(resolve(repoPath, target), "original\n");
		execFileSync("git", ["add", target], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Add stale.txt"], {
			cwd: repoPath,
		});
		// Make the change, capture a REAL patch, then commit it — so the patch's
		// context and blob ids are stale w.r.t. HEAD when we later apply it.
		writeFileSync(resolve(repoPath, target), "changed\n");
		const patch = execFileSync("git", ["diff", "--", target], {
			cwd: repoPath,
			encoding: "utf-8",
		});
		execFileSync("git", ["add", target], { cwd: repoPath });
		execFileSync("git", ["commit", "-m", "Commit the change"], {
			cwd: repoPath,
		});
		// Working tree now matches HEAD, so the patch no longer applies directly.

		await assert.rejects(
			() => execTool(gitTools, "git_apply", { patch }),
			(err) => /does not match|does not apply/.test(err.message.toLowerCase()),
		);

		// 3way should fall back to a merge using the blob ids from the patch.
		const result = await execTool(gitTools, "git_apply", {
			patch,
			threeway: true,
		});
		assert.ok(result.details.threeway, "3way fallback applied");
		assert.equal(
			readFileSync(resolve(repoPath, target), "utf-8"),
			"changed\n",
			"3way merged change",
		);
	});
});
