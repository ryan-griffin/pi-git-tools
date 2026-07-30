/**
 * pi-git-tools — git_cherry_pick tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_cherry_pick",
		label: "Git Cherry-Pick",
		description:
			"Cherry-pick commits onto the current branch, or continue/abort/skip an in-progress cherry-pick.",
		promptSnippet: "Cherry-pick commits",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("pick"),
						Type.Literal("continue"),
						Type.Literal("abort"),
						Type.Literal("skip"),
					],
					{
						description:
							"Action: 'pick' (default), 'continue', 'abort', or 'skip' (during conflict).",
					},
				),
			),
			commits: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Commit ref(s) to cherry-pick (e.g. ['abc123', 'def456']). Required for action=pick.",
				}),
			),
			noCommit: Type.Optional(
				Type.Boolean({
					description: "Apply changes without creating a commit (--no-commit).",
				}),
			),
			signoff: Type.Optional(
				Type.Boolean({
					description: "Add Signed-off-by line (--signoff).",
				}),
			),
			edit: Type.Optional(
				Type.Boolean({
					description:
						"Edit commit message (--edit). Not supported headlessly — will error if true.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "pick";

			if (action === "abort") {
				const output = await run(
					"git",
					["cherry-pick", "--abort"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [
						{
							type: "text",
							text: output || "Cherry-pick aborted.",
						},
					],
					details: { action: "abort" },
				};
			}
			if (action === "continue") {
				const output = await run(
					"git",
					["cherry-pick", "--continue"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [
						{
							type: "text",
							text: output || "Cherry-pick continued.",
						},
					],
					details: { action: "continue" },
				};
			}
			if (action === "skip") {
				const output = await run(
					"git",
					["cherry-pick", "--skip"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [
						{
							type: "text",
							text: output || "Cherry-pick skipped.",
						},
					],
					details: { action: "skip" },
				};
			}

			if (params.edit) {
				throw new Error(
					"edit: true is not supported in headless environments. " +
						"Omit edit and pass a message via a follow-up commit amend if needed.",
				);
			}
			if (!params.commits || params.commits.length === 0) {
				throw new Error("At least one commit ref is required for cherry-pick.");
			}
			for (const c of params.commits) {
				validateCommitish(c, "cherry-pick commit");
			}
			const args = ["cherry-pick"];
			if (params.noCommit) args.push("--no-commit");
			if (params.signoff) args.push("--signoff");
			args.push(...params.commits);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "Cherry-pick completed." }],
				details: {
					action: "pick",
					commits: params.commits,
					noCommit: Boolean(params.noCommit),
				},
			};
		},
	});
}
