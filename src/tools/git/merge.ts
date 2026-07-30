/**
 * pi-git-tools — git_merge tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateBranchName } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_merge",
		label: "Git Merge",
		description:
			"Merge a branch into the current branch, or continue/abort an in-progress merge. " +
			"Use --no-ff to force a merge commit, --squash to squash commits.",
		promptSnippet: "Merge a branch",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("merge"),
						Type.Literal("continue"),
						Type.Literal("abort"),
					],
					{
						description:
							"Action: 'merge' (default), 'continue' (after resolving conflicts), or 'abort'.",
					},
				),
			),
			branch: Type.Optional(
				Type.String({
					description:
						"Branch name to merge into the current branch (required for action=merge).",
				}),
			),
			noFF: Type.Optional(
				Type.Boolean({
					description:
						"Create a merge commit even when fast-forward is possible (--no-ff). Cannot be used with squash.",
				}),
			),
			squash: Type.Optional(
				Type.Boolean({
					description:
						"Squash commits from the source branch into one (--squash). Only stages changes — you must run git_commit afterwards. Cannot be used with noFF.",
				}),
			),
			message: Type.Optional(
				Type.String({
					description: "Merge message (for --no-ff merge commits).",
				}),
			),
			ffOnly: Type.Optional(
				Type.Boolean({
					description:
						"Only merge if fast-forward is possible (--ff-only). Refuses to merge if divergence exists.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "merge";

			if (action === "abort") {
				const output = await run(
					"git",
					["merge", "--abort"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [{ type: "text", text: output || "Merge aborted." }],
					details: { action: "abort" },
				};
			}
			if (action === "continue") {
				const output = await run(
					"git",
					["merge", "--continue"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [{ type: "text", text: output || "Merge continued." }],
					details: { action: "continue" },
				};
			}

			if (!params.branch) throw new Error("'branch' is required to merge.");
			if (params.noFF && params.squash) {
				throw new Error("Cannot use both 'noFF' and 'squash' together.");
			}
			if (params.ffOnly && params.noFF) {
				throw new Error("'ffOnly' and 'noFF' are mutually exclusive.");
			}
			if (params.ffOnly && params.squash) {
				throw new Error("'ffOnly' and 'squash' are mutually exclusive.");
			}
			validateBranchName(params.branch, "merge branch");
			const args = ["merge", params.branch];
			if (params.ffOnly) args.push("--ff-only");
			if (params.noFF) args.push("--no-ff");
			if (params.squash) args.push("--squash");
			if (params.message) args.push("-m", params.message);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "Merge completed." }],
				details: {
					action: "merge",
					branch: params.branch,
					noFF: Boolean(params.noFF),
					squash: Boolean(params.squash),
					ffOnly: Boolean(params.ffOnly),
				},
			};
		},
	});
}
