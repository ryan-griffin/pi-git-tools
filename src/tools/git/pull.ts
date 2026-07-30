/**
 * pi-git-tools — git_pull tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateBranchName, validateRemoteName } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_pull",
		label: "Git Pull",
		description:
			"Fetch from and integrate with a remote repository. Defaults to the current branch's upstream. Supports rebase mode.",
		promptSnippet: "Pull latest changes",
		parameters: Type.Object({
			remote: Type.Optional(
				Type.String({
					description: "Remote name (default: origin).",
				}),
			),
			branch: Type.Optional(
				Type.String({
					description:
						"Branch to pull from (default: current branch's upstream).",
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
						"Automatically stash and pop local changes before/after pull (--autostash).",
				}),
			),
			noFF: Type.Optional(
				Type.Boolean({
					description:
						"Create a merge commit even if fast-forward is possible (--no-ff).",
				}),
			),
			squash: Type.Optional(
				Type.Boolean({
					description:
						"Squash pulled commits into a single commit (--squash). Only stages changes — you must commit afterwards.",
				}),
			),
		}),
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
			const remote = params.remote || (params.branch ? "origin" : undefined);
			if (remote) {
				validateRemoteName(remote, "pull remote");
				args.push(remote);
			}
			if (params.branch) {
				validateBranchName(params.branch, "pull branch");
				args.push(params.branch);
			}

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
