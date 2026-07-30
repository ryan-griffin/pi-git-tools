/**
 * pi-git-tools — git_add tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_add",
		label: "Git Add",
		description:
			"Stage file contents to the index. Stages specific paths, or all changes with --all/--update. " +
			"Use --intent-to-add (-N) to track new files without staging content.",
		promptSnippet: "Stage files",
		parameters: Type.Object({
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description: "Path(s) to stage (e.g. 'src/file.ts', 'src/').",
				}),
			),
			all: Type.Optional(
				Type.Boolean({
					description:
						"Stage all changes (--all, -A) — new, modified, and deleted files.",
				}),
			),
			update: Type.Optional(
				Type.Boolean({
					description:
						"Stage all changes to tracked files only (--update, -u).",
				}),
			),
			intentToAdd: Type.Optional(
				Type.Boolean({
					description:
						"Record intent to add (--intent-to-add, -N) — track new files without staging content.",
				}),
			),
			force: Type.Optional(
				Type.Boolean({
					description: "Force add ignored files (--force, -f).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);

			const hasPaths = params.paths && params.paths.length > 0;
			if (!hasPaths && !params.all && !params.update) {
				throw new Error(
					"Provide 'paths' to stage specific files, or use 'all: true' or 'update: true'.",
				);
			}
			if (params.intentToAdd && (params.all || params.update)) {
				throw new Error(
					"'intentToAdd' cannot be combined with 'all' or 'update' (git rejects -N with -A/-u).",
				);
			}

			const paths = params.paths || [];

			if (hasPaths) {
				if (params.all || params.update) {
					throw new Error("'paths' cannot be combined with 'all' or 'update'.");
				}
				for (const p of paths) {
					validateGitPath(p, "add path");
				}
			}

			const args = ["add"];
			if (params.all && params.update) {
				throw new Error("'all' and 'update' are mutually exclusive.");
			}
			if (params.all) args.push("-A");
			if (params.update) args.push("-u");
			if (params.intentToAdd) args.push("-N");
			if (params.force) args.push("-f");
			if (hasPaths) {
				args.push("--", ...paths);
			}

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [
					{
						type: "text",
						text: output || "Files staged.",
					},
				],
				details: {
					all: Boolean(params.all),
					update: Boolean(params.update),
					intentToAdd: Boolean(params.intentToAdd),
					force: Boolean(params.force),
					pathCount: hasPaths ? paths.length : 0,
					paths: hasPaths ? paths : undefined,
				},
			};
		},
	});
}
