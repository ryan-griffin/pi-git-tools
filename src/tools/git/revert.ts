/**
 * pi-git-tools — git_revert tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_revert",
		label: "Git Revert",
		description:
			"Revert a commit by creating an inverse commit, or continue/abort an in-progress revert. " +
			"Safely undoes changes on shared branches.",
		promptSnippet: "Revert a commit",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("revert"),
						Type.Literal("continue"),
						Type.Literal("abort"),
					],
					{
						description:
							"Action: 'revert' (default), 'continue' (after conflicts), or 'abort'.",
					},
				),
			),
			commit: Type.Optional(
				Type.String({
					description: "Commit ref to revert (required for action=revert).",
				}),
			),
			noCommit: Type.Optional(
				Type.Boolean({
					description:
						"Apply the inverse change without creating a commit (--no-commit).",
				}),
			),
			edit: Type.Optional(
				Type.Boolean({
					description:
						"Edit the revert commit message (--edit). Not supported headlessly — will error if true.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "revert";

			if (action === "abort") {
				const output = await run(
					"git",
					["revert", "--abort"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [{ type: "text", text: output || "Revert aborted." }],
					details: { action: "abort" },
				};
			}
			if (action === "continue") {
				const output = await run(
					"git",
					["revert", "--continue"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [{ type: "text", text: output || "Revert continued." }],
					details: { action: "continue" },
				};
			}

			if (params.edit) {
				throw new Error(
					"edit: true is not supported in headless environments. " +
						"Omit edit; git will use the default revert message.",
				);
			}
			if (!params.commit) throw new Error("'commit' is required to revert.");
			validateCommitish(params.commit, "revert commit");
			const args = ["revert", "--no-edit"];
			if (params.noCommit) args.push("--no-commit");
			args.push(params.commit);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "Revert completed." }],
				details: {
					action: "revert",
					commit: params.commit,
					noCommit: Boolean(params.noCommit),
				},
			};
		},
	});
}
