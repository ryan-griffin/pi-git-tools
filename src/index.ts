/**
 * pi-git-tools — Git and GitHub CLI tools for the pi coding agent.
 *
 * Provides tools for common git operations (status, diff, log, branch,
 * commit, worktree, stash, clone, fetch, merge, rebase, reset, pull, push,
 * tag, cherry-pick, revert, clean, remote, config) and GitHub CLI operations
 * (PRs, issues, repo info, search).
 *
 * Requires `git` and optionally `gh` (GitHub CLI) to be installed on the
 * system and available in PATH.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { wireDynamicTools } from "./activate.js";
import { registerGhTools } from "./gh-tools.js";
import { registerGitTools } from "./git-tools.js";

export * from "./activate.js";
export * from "./utils.js";
export * from "./validation.js";

export default function piGitToolsExtension(pi: ExtensionAPI) {
	registerGitTools(pi);
	registerGhTools(pi);
	wireDynamicTools(pi);
}
