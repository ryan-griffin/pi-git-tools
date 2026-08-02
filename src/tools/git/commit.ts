/**
 * pi-git-tools — git_commit tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_commit",
		label: "Git Commit",
		description:
			"Create a commit. Can stage specific paths first, amend the last commit, or create an empty commit. " +
			"Use git_add for broader staging (staging is always explicit).",
		promptSnippet: "Stage and commit changes",
		parameters: Type.Object({
			message: Type.Optional(
				Type.String({
					description:
						"Commit message (optional when amending without changing message).",
				}),
			),
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description: "Specific paths to stage before committing.",
				}),
			),
			amend: Type.Optional(
				Type.Boolean({
					description: "Amend the last commit instead of creating a new one.",
				}),
			),
			allowEmpty: Type.Optional(
				Type.Boolean({
					description: "Allow an empty commit (--allow-empty).",
				}),
			),
			signoff: Type.Optional(
				Type.Boolean({
					description: "Add Signed-off-by line (--signoff) for DCO compliance.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);

			// Validate message requirement BEFORE any side effects
			if (!params.amend && !params.message) {
				throw new Error("'message' is required for a new commit.");
			}

			if (params.paths && params.paths.length > 0) {
				for (const p of params.paths) {
					validateGitPath(p, "commit path");
				}
				await run(
					"git",
					["add", "--", ...params.paths],
					root,
					undefined,
					_signal,
				);
			}

			const args = ["commit"];
			if (params.signoff) args.push("-s");
			if (params.amend) {
				args.push("--amend");
				if (params.message) {
					args.push("-m", params.message);
				} else {
					// Keep prior message; never open an editor in headless mode
					args.push("--no-edit");
				}
				if (params.allowEmpty) args.push("--allow-empty");
			} else {
				if (!params.message)
					throw new Error("'message' is required for a new commit.");
				args.push("-m", params.message);
				if (params.allowEmpty) args.push("--allow-empty");
			}

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "Commit succeeded." }],
				details: {
					success: true,
					message: params.message || null,
					amend: !!params.amend,
					signoff: !!params.signoff,
				},
			};
		},
	});
}
