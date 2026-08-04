/**
 * Unit tests for src/hints.ts — the curated git error → tool-schema hint
 * table. Every fixture is a real git stderr capture (git 2.4x), so the
 * patterns are pinned to actual message text, not guessed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { gitErrorHint } = await import("../../src/hints.ts");

/** Assert the rule for the given subcommand+stderr yields a hint. */
function expectHint(subcommand, stderr, needle, exitCode) {
	const hint = gitErrorHint([subcommand], stderr, exitCode);
	assert.ok(hint, `expected a hint for ${subcommand}`);
	assert.ok(hint.includes(needle), `hint "${hint}" should include "${needle}"`);
}

function expectNoHint(subcommand, stderr, exitCode) {
	assert.equal(
		gitErrorHint([subcommand], stderr, exitCode),
		null,
		`no hint expected for ${subcommand}`,
	);
}

describe("gitErrorHint", () => {
	it("hints on push rejected (fetch first)", () => {
		expectHint(
			"push",
			" ! [rejected]        HEAD -> main (fetch first)\n" +
				"error: failed to push some refs to '/tmp/r.git'\n" +
				"hint: Updates were rejected because the remote contains work that you do not\n" +
				"hint: have locally. This is usually caused by another repository pushing to\n" +
				"hint: the same ref.\n",
			"forceWithLease: true",
		);
	});

	it("hints on push rejected (non-fast-forward)", () => {
		expectHint(
			"push",
			" ! [rejected]        HEAD -> main (non-fast-forward)\n" +
				"error: failed to push some refs to '../r.git'\n" +
				"hint: Updates were rejected because a pushed branch tip is behind its remote\n" +
				"hint: counterpart. If you want to integrate the remote changes, use 'git pull'\n",
			"git_pull",
		);
	});

	it("hints on push without upstream", () => {
		expectHint(
			"push",
			"fatal: The current branch main has no upstream branch.\n" +
				"To push the current branch and set the remote as upstream, use\n",
			"setUpstream: true",
		);
	});

	it("hints on pull without tracking info", () => {
		expectHint(
			"pull",
			"There is no tracking information for the current branch.\n" +
				"Please specify which branch you want to merge with.\n",
			"remote and branch",
		);
	});

	it("hints on tag already exists", () => {
		expectHint("tag", "fatal: tag 'v1' already exists\n", "force: true");
	});

	it("hints on deleting an unmerged branch", () => {
		expectHint(
			"branch",
			"error: the branch 'side' is not fully merged\n" +
				"hint: If you are sure you want to delete it, run 'git branch -D side'\n",
			"force: true",
		);
	});

	it("hints on deleting a branch used by a worktree", () => {
		expectHint(
			"branch",
			"error: cannot delete branch 'main' used by worktree at '/tmp/w'\n",
			"git_worktree remove",
		);
	});

	it("hints on stash pop conflict", () => {
		expectHint(
			"stash",
			"CONFLICT (content): Merge conflict in s\n" +
				"The stash entry is kept in case you need it again.\n",
			"git_stash drop",
		);
	});

	it("hints on git_apply patch failure", () => {
		expectHint(
			"apply",
			"error: patch failed: src/a.ts:12\n" +
				"error: src/a.ts: patch does not apply\n",
			"threeway: true",
		);
	});

	it("hints on conflicts during merge/cherry-pick/rebase", () => {
		expectHint(
			"merge",
			"CONFLICT (content): Merge conflict in f\n" +
				"Automatic merge failed; fix conflicts and then commit the result.\n",
			"continue",
		);
		expectHint(
			"cherry-pick",
			"CONFLICT (content): Merge conflict in f\n" +
				"error: could not apply 0af5fef... s1\n",
			"continue",
		);
	});

	it("hints on committing with unresolved conflicts", () => {
		expectHint(
			"commit",
			"error: Committing is not possible because you have unmerged files.\n" +
				"hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
				"fatal: Exiting because of an unresolved conflict.\n",
			"continue",
		);
	});

	it("hints on local changes blocking an operation", () => {
		expectHint(
			"merge",
			"error: Your local changes to the following files would be overwritten by merge:\n" +
				"\tf\n" +
				"Please commit your changes or stash them before you merge.\n",
			"git_stash push",
		);
		expectHint(
			"pull",
			"error: cannot pull with rebase: Your index contains uncommitted changes.\n" +
				"error: Please commit or stash them.\n",
			"git_stash push",
		);
	});

	it("hints on an unresolvable ref", () => {
		expectHint(
			"show",
			"fatal: ambiguous argument 'nope': unknown revision or path not in the working tree.\n",
			"doesn't resolve",
		);
	});

	it("hints on a pathspec that matches nothing", () => {
		expectHint(
			"restore",
			"error: pathspec 'nope.txt' did not match any file(s) known to git.\n",
			"Check the path",
		);
	});

	it("hints on unrelated histories", () => {
		expectHint(
			"merge",
			"fatal: refusing to merge unrelated histories\n",
			"git_cherry_pick",
		);
	});

	it("hints on network/auth failures", () => {
		expectHint(
			"fetch",
			"fatal: unable to access 'https://example.com/r.git/': Could not resolve host: example.com\n",
			"Network or auth",
		);
		expectHint(
			"push",
			"git@github.com: Permission denied (publickey).\n" +
				"fatal: Could not read from remote repository.\n",
			"Network or auth",
		);
	});

	it("hints on usage errors via exit code 129", () => {
		expectHint(
			"merge",
			"usage: git merge [<options>] [<commit>...]\n   or: git merge --abort\n",
			"Usage error",
			129,
		);
	});

	it("returns null for unknown errors", () => {
		expectNoHint("show", "fatal: bad object deadbeef\n");
		expectNoHint("config", "");
		expectNoHint("push", "error: some unknown failure\n");
	});

	it("respects the subcommand scoping", () => {
		// 'tag ... already exists' only fires for the tag subcommand.
		expectNoHint("branch", "fatal: tag 'v1' already exists\n");
		// 'used by worktree' only fires for the branch subcommand.
		expectNoHint(
			"worktree",
			"error: cannot delete branch 'main' used by worktree at '/tmp/w'\n",
		);
	});

	it("first matching rule wins", () => {
		// Push rejected matches the push-specific rule before any generic one.
		const hint = gitErrorHint(
			["push"],
			"error: failed to push some refs to 'x'\n",
		);
		assert.ok(hint.includes("forceWithLease"));
	});

	it("gh-style commands are not annotated by the caller (bin guard)", () => {
		// The bin === "git" guard lives in run(); the pure function itself
		// still works on any argv, so subcommand-less calls are safe.
		assert.equal(gitErrorHint([], ""), null);
	});
});
