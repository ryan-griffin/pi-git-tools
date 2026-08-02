/**
 * pi-git-tools — git_show tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish, validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_show",
		label: "Git Show",
		description:
			"Show a commit, tag, or other object — metadata and patch. Defaults to HEAD. " +
			"Use stat: true for a diffstat summary instead of the full patch.",
		promptSnippet: "Show commit details",
		parameters: Type.Object({
			ref: Type.Optional(
				Type.String({
					description:
						"Commit-ish to show (default: HEAD). E.g. 'abc123', 'HEAD~1', 'v1.0.0'.",
				}),
			),
			path: Type.Optional(
				Type.String({
					description:
						"Optional path to limit the shown patch (e.g. 'src/index.ts').",
				}),
			),
			stat: Type.Optional(
				Type.Boolean({
					description:
						"Show diffstat summary instead of the full patch (--stat).",
				}),
			),
			nameOnly: Type.Optional(
				Type.Boolean({
					description: "Show only names of changed files (--name-only).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const ref = params.ref || "HEAD";
			validateCommitish(ref, "show ref");
			if (params.path) validateGitPath(params.path, "show path");

			const args = ["show", "--no-color", ref];
			if (params.stat) args.push("--stat");
			if (params.nameOnly) args.push("--name-only");
			if (params.path) args.push("--", params.path);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "(empty)" }],
				details: {
					ref,
					stat: Boolean(params.stat),
					nameOnly: Boolean(params.nameOnly),
					path: params.path || null,
				},
			};
		},
	});
}
