/**
 * pi-git-tools — git_restore tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish, validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_restore",
		label: "Git Restore",
		description:
			"Restore working tree files or the index. Can restore from the index (default), " +
			"a specific commit via --source, or during merge conflicts with --ours/--theirs.",
		promptSnippet: "Restore file(s)",
		parameters: Type.Object({
			paths: Type.Array(
				Type.String({
					description: "Path(s) to restore (e.g. 'src/file.ts', 'src/').",
				}),
				{
					description: "Path(s) to restore.",
					minItems: 1,
				},
			),
			source: Type.Optional(
				Type.String({
					description:
						"Tree-ish to restore from (e.g. 'HEAD~1', 'abc123'). Defaults to the index when omitted. " +
						"Cannot be combined with --ours/--theirs.",
				}),
			),
			staged: Type.Optional(
				Type.Boolean({
					description:
						"Restore the index (unstage). Default: false. " +
						"When false (and --worktree is also false), git defaults to --worktree.",
				}),
			),
			worktree: Type.Optional(
				Type.Boolean({
					description:
						"Restore the working tree. Default: true when neither staged nor worktree is explicit. " +
						"Pass false to suppress worktree restoration when only unstaging.",
				}),
			),
			ours: Type.Optional(
				Type.Boolean({
					description:
						"For conflicted files: restore our side. Cannot be combined with --theirs or --source.",
				}),
			),
			theirs: Type.Optional(
				Type.Boolean({
					description:
						"For conflicted files: restore their side. Cannot be combined with --ours or --source.",
				}),
			),
			ignoreUnmerged: Type.Optional(
				Type.Boolean({
					description:
						"Skip unmerged entries (--ignore-unmerged). Useful when restoring untracked or modified files during a merge.",
				}),
			),
			recurseSubmodules: Type.Optional(
				Type.Boolean({
					description: "Restore submodules recursively (--recurse-submodules).",
				}),
			),
			overlay: Type.Optional(
				Type.Boolean({
					description:
						"Overlay mode (git 2.38+). Pass false to remove files not present in the source (--no-overlay). " +
						"Default: true (files not in source are left untouched).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);

			if (!params.paths || params.paths.length === 0) {
				throw new Error("'paths' is required with at least one path.");
			}

			if (params.ours && params.theirs) {
				throw new Error("'ours' and 'theirs' are mutually exclusive.");
			}
			if (params.source && (params.ours || params.theirs)) {
				throw new Error("'source' cannot be combined with 'ours' or 'theirs'.");
			}

			for (const p of params.paths) {
				validateGitPath(p, "restore path");
			}
			if (params.source) {
				validateCommitish(params.source, "restore source");
			}

			const args = ["restore"];
			if (params.source) args.push("--source", params.source);
			if (params.overlay === false) args.push("--no-overlay");
			if (params.staged) args.push("--staged");
			if (params.worktree === false) {
				// Explicitly suppressed — omit --worktree to restore only --staged
			} else if (params.worktree || !params.staged) {
				// Default to --worktree when neither flagged, or when worktree is explicitly true
				args.push("--worktree");
			}
			if (params.ours) args.push("--ours");
			if (params.theirs) args.push("--theirs");
			if (params.ignoreUnmerged) args.push("--ignore-unmerged");
			if (params.recurseSubmodules) args.push("--recurse-submodules");
			args.push("--", ...params.paths);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [
					{
						type: "text",
						text: output || `Restored ${params.paths.length} path(s).`,
					},
				],
				details: {
					source: params.source || null,
					staged: !!params.staged,
					worktree:
						params.worktree !== false && (params.worktree || !params.staged),
					ours: !!params.ours,
					theirs: !!params.theirs,
					ignoreUnmerged: !!params.ignoreUnmerged,
					recurseSubmodules: !!params.recurseSubmodules,
					overlay: params.overlay !== false,
					paths: params.paths,
				},
			};
		},
	});
}
