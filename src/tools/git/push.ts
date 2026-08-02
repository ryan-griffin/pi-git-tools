/**
 * pi-git-tools — git_push tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateBranchName, validateRemoteName } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_push",
		label: "Git Push",
		description:
			"Push local commits to a remote repository. Supports setting upstream, force push, and dry-run.",
		promptSnippet: "Push commits to remote",
		parameters: Type.Object({
			remote: Type.Optional(
				Type.String({
					description: "Remote name (default: origin).",
				}),
			),
			branch: Type.Optional(
				Type.String({
					description: "Branch to push (default: current branch).",
				}),
			),
			setUpstream: Type.Optional(
				Type.Boolean({
					description: "Set the upstream tracking reference (-u).",
				}),
			),
			force: Type.Optional(
				Type.Boolean({
					description:
						"Force push (use with caution — prefer force-with-lease). Cannot be used together with forceWithLease.",
				}),
			),
			forceWithLease: Type.Optional(
				Type.Boolean({
					description:
						"Force push with lease (safer than force). Cannot be used together with force.",
				}),
			),
			dryRun: Type.Optional(
				Type.Boolean({
					description:
						"Dry run — show what would be pushed without actually pushing.",
				}),
			),
			deleteBranch: Type.Optional(
				Type.String({
					description:
						"Delete a remote branch (e.g. 'feature/old-branch'). Cannot be used with 'branch'.",
				}),
			),
			tags: Type.Optional(
				Type.Boolean({
					description: "Push all tags (--tags).",
				}),
			),
			followTags: Type.Optional(
				Type.Boolean({
					description:
						"Push missing tags reachable from pushed commits (--follow-tags).",
				}),
			),
			forceIfIncludes: Type.Optional(
				Type.Boolean({
					description:
						"Force push only if the remote ref is an ancestor of the local ref (--force-if-includes).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			if (params.force && params.forceWithLease) {
				throw new Error(
					"Cannot use both 'force' and 'forceWithLease' together. Prefer force-with-lease for safety.",
				);
			}
			if (params.deleteBranch && params.branch) {
				throw new Error(
					"Cannot use both 'deleteBranch' and 'branch' together.",
				);
			}
			if (params.forceIfIncludes && !params.forceWithLease) {
				throw new Error(
					"'forceIfIncludes' requires 'forceWithLease' — git silently ignores --force-if-includes on its own.",
				);
			}
			const args = ["push"];
			if (params.force) args.push("--force");
			if (params.forceWithLease) args.push("--force-with-lease");
			if (params.forceIfIncludes) args.push("--force-if-includes");
			if (params.setUpstream) args.push("-u");
			if (params.dryRun) args.push("--dry-run");
			if (params.tags) args.push("--tags");
			if (params.followTags) args.push("--follow-tags");
			if (params.deleteBranch) {
				validateBranchName(params.deleteBranch, "delete branch");
			}
			let remote = params.remote;
			if (!remote && (params.deleteBranch || params.branch)) remote = "origin";
			if (remote) {
				validateRemoteName(remote, "push remote");
				args.push(remote);
			}
			if (params.deleteBranch) {
				args.push("--delete", params.deleteBranch);
			} else if (params.branch) {
				validateBranchName(params.branch, "push branch");
				args.push(params.branch);
			}

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output }],
				details: {
					remote: remote || "default",
					branch: params.deleteBranch || params.branch || "current",
					dryRun: !!params.dryRun,
					deleteBranch: params.deleteBranch || undefined,
					tags: !!params.tags,
					followTags: !!params.followTags,
				},
			};
		},
	});
}
