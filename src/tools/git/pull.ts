/**
 * pi-git-tools — git_pull tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateBranchName, validateRemoteName } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_pull",
		label: "Git Pull",
		description:
			"Fetch from and integrate with a remote repository. Defaults to the current branch's upstream. Supports rebase mode.",
		promptSnippet: "Pull latest changes",
		parameters: Type.Object(
			{
				remote: Type.Optional(
					Type.String({
						description:
							"Remote name (default: current branch's upstream; origin when 'branch' is given).",
						minLength: 1,
					}),
				),
				branch: Type.Optional(
					Type.String({
						description:
							"Branch to pull from (default: current branch's upstream).",
						minLength: 1,
					}),
				),
				rebase: Type.Optional(
					Type.Boolean({
						description: "Use rebase instead of merge.",
					}),
				),
				ffOnly: Type.Optional(
					Type.Boolean({
						description: "Only allow fast-forward merges.",
					}),
				),
				autostash: Type.Optional(
					Type.Boolean({
						description:
							"Automatically stash and pop local changes before/after pull.",
					}),
				),
				noFF: Type.Optional(
					Type.Boolean({
						description:
							"Create a merge commit even if fast-forward is possible.",
					}),
				),
				squash: Type.Optional(
					Type.Boolean({
						description:
							"Squash pulled commits into a single commit. Only stages changes — you must commit afterwards.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			if (params.noFF && params.squash) {
				throw new Error("Cannot use both 'noFF' and 'squash' together.");
			}
			if (params.ffOnly && params.noFF) {
				throw new Error("'ffOnly' and 'noFF' are mutually exclusive.");
			}
			if (params.ffOnly && params.squash) {
				throw new Error("'ffOnly' and 'squash' are mutually exclusive.");
			}
			const args = ["pull"];
			if (params.rebase) args.push("--rebase");
			if (params.ffOnly) args.push("--ff-only");
			if (params.autostash) args.push("--autostash");
			if (params.noFF) args.push("--no-ff");
			if (params.squash) args.push("--squash");
			// Validate present-but-empty strings: `""` must not be silently
			// treated as "omitted".
			if (params.remote !== undefined) {
				validateRemoteName(params.remote, "pull remote");
			}
			if (params.branch !== undefined) {
				validateBranchName(params.branch, "pull branch");
			}
			// Bare `git pull` follows the current branch's upstream (git-native);
			// a branch refspec needs an explicit remote, defaulting to origin.
			const remote = params.remote || (params.branch ? "origin" : undefined);
			if (remote) args.push(remote);
			if (params.branch) args.push(params.branch);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output }],
				details: {
					remote: remote || "default",
					branch: params.branch || "default",
				},
			};
		},
	});
}
