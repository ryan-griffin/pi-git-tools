/**
 * pi-git-tools — git_clone tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { resolveCwd, run } from "../../utils.js";
import {
	validateBranchName,
	validateCommandValue,
	validateDestinationPath,
	validateRemoteUrl,
} from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_clone",
		label: "Git Clone",
		description:
			"Clone a git repository into a local directory. Supports shallow clones and specific branches.",
		promptSnippet: "Clone a repository",
		parameters: Type.Object(
			{
				url: Type.String({
					description: "Repository URL to clone (HTTPS or SSH).",
				}),
				directory: Type.Optional(
					Type.String({
						description: "Target directory name. Defaults to the repo name.",
					}),
				),
				branch: Type.Optional(
					Type.String({
						description: "Clone a specific branch instead of the default.",
					}),
				),
				depth: Type.Optional(
					Type.Integer({
						description:
							"Create a shallow clone with history truncated to N commits.",
						minimum: 1,
					}),
				),
				singleBranch: Type.Optional(
					Type.Boolean({
						description:
							"Only clone the history for the specified branch (--single-branch).",
					}),
				),
				filter: Type.Optional(
					Type.String({
						description:
							"Partial clone filter (e.g. 'blob:none' to skip all blob downloads, 'tree:0' for commits only).",
					}),
				),
				recurseSubmodules: Type.Optional(
					Type.Boolean({
						description:
							"Initialize and clone submodules recursively (--recurse-submodules).",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			validateRemoteUrl(params.url, "clone url");
			const args = ["clone"];
			if (params.depth) args.push("--depth", String(params.depth));
			if (params.singleBranch) args.push("--single-branch");
			if (params.filter) {
				validateCommandValue(params.filter, "clone filter");
				args.push("--filter", params.filter);
			}
			if (params.recurseSubmodules) args.push("--recurse-submodules");
			if (params.branch) {
				validateBranchName(params.branch, "clone branch");
				args.push("--branch", params.branch);
			}
			args.push("--", params.url);
			if (params.directory)
				validateDestinationPath(params.directory, "clone directory");
			if (params.directory) args.push(params.directory);

			const output = await run("git", args, cwd, undefined, _signal);
			return {
				content: [{ type: "text", text: output }],
				details: {
					url: params.url,
					directory: params.directory || null,
				},
			};
		},
	});
}
