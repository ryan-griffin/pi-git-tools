/**
 * pi-git-tools — git_clean tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateExcludePattern } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_clean",
		label: "Git Clean",
		description:
			"Remove untracked files from the working tree. Use with caution — can delete files permanently. " +
			"force: true is always required to actually remove files; use dryRun: true to preview first.",
		promptSnippet: "Remove untracked files",
		parameters: Type.Object({
			dryRun: Type.Optional(
				Type.Boolean({
					description:
						"Show what would be removed without actually removing (--dry-run).",
				}),
			),
			force: Type.Optional(
				Type.Boolean({
					description:
						"Force removal of untracked files (-f). Always required to actually remove files (unless dryRun).",
				}),
			),
			directories: Type.Optional(
				Type.Boolean({
					description: "Remove untracked directories as well (-d).",
				}),
			),
			excludePattern: Type.Optional(
				Type.String({
					description:
						"Skip files matching this pattern (--exclude). Comma-separated for multiple patterns.",
				}),
			),
			interactive: Type.Optional(
				Type.Boolean({
					description:
						"Show files interactively for confirmation (-i). Refuses to run in non-TTY environments.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const args = ["clean"];
			if (params.dryRun) args.push("--dry-run");
			// Always require explicit force (unless previewing): plain `git clean` is a
			// no-op only when clean.requireForce is true, and a user gitconfig may set
			// clean.requireForce=false, which would make it delete files silently.
			if (!params.force && !params.dryRun) {
				throw new Error(
					"force=true is required to remove untracked files (git clean -f). " +
						"Use dryRun: true to preview what would be removed first.",
				);
			}
			if (params.force) args.push("-f");
			if (params.directories) args.push("-d");
			if (params.excludePattern) {
				for (const pat of params.excludePattern.split(",")) {
					const trimmed = pat.trim();
					if (trimmed) {
						validateExcludePattern(trimmed);
						args.push("--exclude", trimmed);
					}
				}
			}
			if (params.interactive) {
				throw new Error(
					"Interactive clean (-i) is not supported in agent/headless environments. " +
						"Use dryRun: true to preview, then force: true to remove.",
				);
			}

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "(nothing to clean)" }],
				details: {
					dryRun: !!params.dryRun,
					force: !!params.force,
					directories: !!params.directories,
				},
			};
		},
	});
}
