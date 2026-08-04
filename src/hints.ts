/**
 * pi-git-tools — git error hints.
 *
 * Git's error messages frequently tell a human what to do next ("run 'git
 * branch -D x'", "use 'git pull'", "see 'git push --help'"). For an agent
 * those flag names are dead ends: the model can only act through this
 * extension's tools, so the useful translation is into tool-schema terms
 * (git_branch with force: true, git_pull first, git_push with
 * setUpstream: true).
 *
 * Fully automatic extraction from arbitrary git prose is not viable — the
 * messages are unstructured natural language with no stable error codes
 * (exit codes are coarse: 1/128/129). Instead, this module curates a small
 * table of high-confidence patterns pinned to git's real message text,
 * which is extremely stable across versions. Rules are conservative: a
 * hint is only emitted on an exact, known failure; a wrong hint is worse
 * than none.
 *
 * The annotator hooks into the single error choke point (run() in
 * utils.ts), so no tool module needs changes. The hint is appended to the
 * CommandError message (tail-first truncation keeps it) and carried on the
 * error object.
 */

/** One curated pattern → tool-schema hint pair. */
export interface GitHintRule {
	/** Git subcommand this rule applies to (argv[0]); null = any. */
	subcommand: string | null;
	/** Stable pattern found in git's stderr/stdout. */
	pattern: RegExp;
	/** Suggestion phrased in this extension's tool-schema terms. */
	hint: string;
}

// Ordered: more specific rules first. Each pattern is pinned to real git
// stderr (see test/unit/hints.test.mjs fixtures, captured from git 2.4x).
const GIT_HINT_RULES: GitHintRule[] = [
	{
		subcommand: "push",
		pattern: /failed to push some refs|Updates were rejected/,
		hint: "Remote rejected the push (non-fast-forward). Run git_pull to integrate the remote changes, then git_push again — or git_push with forceWithLease: true to overwrite the remote ref.",
	},
	{
		subcommand: "push",
		pattern: /no upstream branch|has no upstream/,
		hint: "This branch has no upstream set. Use git_push with setUpstream: true (add remote/branch) to push and start tracking.",
	},
	{
		subcommand: "pull",
		pattern: /no tracking information/,
		hint: "No tracking information for this branch. Pass remote and branch to git_pull explicitly.",
	},
	{
		subcommand: "tag",
		pattern: /tag '[^']+' already exists/,
		hint: "A tag with this name already exists. Use git_tag with force: true to replace it.",
	},
	{
		subcommand: "branch",
		pattern: /is not fully merged/,
		hint: "This branch is not fully merged. Delete it with git_branch force: true (-D), or merge it first.",
	},
	{
		subcommand: "branch",
		pattern: /used by worktree/,
		hint: "This branch is checked out in another worktree. Remove that worktree first with git_worktree remove, then delete the branch.",
	},
	{
		subcommand: "stash",
		pattern: /stash entry is kept/,
		hint: "The stash pop/apply conflicted and the stash was kept. Resolve the conflicts, then git_stash drop (or pop again once resolved).",
	},
	{
		subcommand: "apply",
		pattern: /patch (failed|does not apply)/,
		hint: "The patch doesn't apply to the current tree. Regenerate it against current HEAD, or use git_apply with threeway: true.",
	},
	{
		// Merge/rebase/cherry-pick/revert started, but the index still has
		// unresolved conflicts — the operation cannot proceed until resolved.
		subcommand: null,
		pattern:
			/is not possible because you have unmerged files|not concluded your merge/,
		hint: "An operation is in progress with unresolved conflicts. Resolve them, then continue (git_merge / git_rebase / git_cherry_pick continue) or abort.",
	},
	{
		subcommand: null,
		pattern: /CONFLICT \(|Automatic merge failed|could not apply [0-9a-f]{7,}/,
		hint: "The operation hit conflicts. Resolve the conflicting files, then continue (git_merge / git_rebase / git_cherry_pick continue) or abort.",
	},
	{
		subcommand: null,
		pattern: /would be overwritten|Please commit (your changes )?or stash them/,
		hint: "Local changes are in the way. git_stash push (or git_commit) them first, then retry.",
	},
	{
		subcommand: null,
		pattern: /ambiguous argument/,
		hint: "The ref or path doesn't resolve in this repository. Check the value you passed.",
	},
	{
		subcommand: null,
		pattern: /did not match any file/,
		hint: "The path doesn't match any file git knows. Check the path.",
	},
	{
		subcommand: null,
		pattern: /refusing to merge unrelated histories/,
		hint: "The branches share no common history. git_merge can't pass --allow-unrelated-histories — pull with rebase first, or git_cherry_pick the commits instead.",
	},
	{
		subcommand: null,
		pattern:
			/unable to access|Could not resolve host|Connection (refused|reset)|Repository not found|Permission denied \(publickey\)/,
		hint: "Network or auth failure reaching the remote. Check the URL, connectivity, and credentials.",
	},
];

/** Git's usage-error exit code: the arguments don't fit the command. */
const USAGE_HINT =
	"Usage error: the arguments don't fit this git command. Check the parameters you passed — one is likely invalid for this action.";

/**
 * Return a tool-schema hint for a failed git command, or null when the
 * failure isn't one of the known, actionable patterns.
 */
export function gitErrorHint(
	args: readonly string[],
	stderr: string,
	exitCode?: number | string,
): string | null {
	if (exitCode === 129) return USAGE_HINT;
	if (!stderr) return null;
	const subcommand = args[0] ?? "";
	for (const rule of GIT_HINT_RULES) {
		if (rule.subcommand !== null && rule.subcommand !== subcommand) continue;
		if (rule.pattern.test(stderr)) return rule.hint;
	}
	return null;
}
