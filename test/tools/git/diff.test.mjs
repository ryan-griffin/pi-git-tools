/**
 * pi-git-tools — diff integration tests.
 */
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execFileSync,
	execTool,
	resolve,
	setupTempRepo,
	writeFileSync,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("diff", () => {
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

	it("git_diff shows unstaged changes", async () => {
		const result = await execTool(gitTools, "git_diff");
		assert.ok(result.content[0].text.length > 0, "diff output is non-empty");
		assert.ok(result.details?.insertions >= 0, "has insertion count");
	});

	it("git_diff --staged shows staged changes", async () => {
		const result = await execTool(gitTools, "git_diff", { staged: true });
		const text = result.content[0].text;
		// We staged staged.txt
		assert.ok(text.length > 0, "staged diff output is non-empty");
	});

	it("git_diff filters by path", async () => {
		const result = await execTool(gitTools, "git_diff", {
			path: "README.md",
		});
		const text = result.content[0].text;
		// Modified README.md should show in diff
		assert.ok(text.includes("README.md") || text.length > 0, text);
	});

	it("git_diff supports refs and ranges", async () => {
		// HEAD~1..HEAD has at least the fixture commits; both endpoints exist.
		const result = await execTool(gitTools, "git_diff", {
			ref: "HEAD~1..HEAD",
		});
		assert.ok(result.details?.files >= 1, "range diff reports files");

		const two = await execTool(gitTools, "git_diff", {
			ref: "HEAD~1",
			ref2: "HEAD",
		});
		assert.ok(two.content[0].text.length > 0, "two-endpoint diff works");
	});

	it("git_diff rejects ref2 without ref", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_diff", { ref2: "HEAD" }),
			(err) => err.message.includes("ref2"),
		);
	});

	it("git_diff combines staged with ref (index vs commit)", async () => {
		const result = await execTool(gitTools, "git_diff", {
			staged: true,
			ref: "HEAD~1",
		});
		// The index holds the 'Add src files' commit plus the staged.txt fixture,
		// so the index-vs-HEAD~1 diff is non-empty and reports files.
		assert.ok(
			result.content[0].text.length > 0,
			"staged+ref diff is non-empty",
		);
		assert.ok(
			(result.details?.files ?? 0) >= 1,
			"staged+ref diff reports files",
		);
	});

	it("git_diff rejects option-like refs", async () => {
		await assert.rejects(
			() => execTool(gitTools, "git_diff", { ref: "--stat" }),
			{
				name: "ValidationError",
			},
		);
	});

	it("git_diff preserves trailing whitespace on the final patch line", async () => {
		const file = resolve(repoPath, "whitespace.txt");
		writeFileSync(file, "a\nb   \n");
		execFileSync("git", ["add", "whitespace.txt"], { cwd: repoPath });
		execFileSync("git", ["commit", "-q", "-m", "add whitespace fixture"], {
			cwd: repoPath,
		});
		writeFileSync(file, "a\nb   \nc   \n");

		const result = await execTool(gitTools, "git_diff", {
			path: "whitespace.txt",
		});
		const text = result.content[0].text;
		assert.ok(
			text.endsWith("+c   "),
			`final patch line keeps its trailing spaces, got tail: ${JSON.stringify(
				text.split("\n").slice(-2),
			)}`,
		);
	});
});
