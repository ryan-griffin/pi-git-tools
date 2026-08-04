/**
 * pi-git-tools — git_reset tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_reset",
		label: "Git Reset",
		description:
			"Reset the current HEAD to a specified state. Supports --soft (keep changes staged), --mixed (keep changes unstaged, default), and --hard (discard changes). " +
			"File-level operations (unstage, discard) live in git_restore.",
		promptSnippet: "Reset HEAD to a previous state",
		parameters: Type.Object({
			target: Type.Optional(
				Type.String({
					description:
						"Target ref (default: HEAD, e.g. 'HEAD~1', 'abc123', 'main').",
				}),
			),
			mode: Type.Optional(
				Type.Union(
					[
						Type.Literal("soft"),
						Type.Literal("mixed"),
						Type.Literal("hard"),
						Type.Literal("keep"),
					],
					{
						description:
							"Reset mode: 'soft' (keep staged), 'mixed' (keep unstaged, default), 'hard' (discard all changes), 'keep' (like hard but keeps local changes).",
					},
				),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);

			const mode = params.mode || "mixed";
			const validModes = ["soft", "mixed", "hard", "keep"];
			if (!validModes.includes(mode)) {
				throw new Error(
					`Invalid mode '${mode}'. Use one of: ${validModes.join(", ")}`,
				);
			}
			const args = ["reset", `--${mode}`];
			if (params.target) {
				validateCommitish(params.target, "reset target");
				args.push(params.target);
			}

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output }],
				details: { mode, target: params.target || "HEAD" },
			};
		},
	});
}
