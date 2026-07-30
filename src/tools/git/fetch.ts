/**
 * pi-git-tools — git_fetch tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateBranchName, validateRemoteName } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_fetch",
		label: "Git Fetch",
		description: "Fetch from a remote repository. Defaults to origin.",
		promptSnippet: "Fetch from remote",
		parameters: Type.Object({
			remote: Type.Optional(
				Type.String({
					description: "Remote name (default: origin).",
				}),
			),
			branch: Type.Optional(
				Type.String({
					description: "Branch to fetch (default: all branches).",
				}),
			),
			prune: Type.Optional(
				Type.Boolean({
					description:
						"Prune remote-tracking branches no longer present on remote (--prune).",
				}),
			),
			depth: Type.Optional(
				Type.Integer({
					description: "Depth of history to fetch (shallow fetch).",
					minimum: 1,
				}),
			),
			all: Type.Optional(
				Type.Boolean({
					description: "Fetch from all remotes (--all).",
				}),
			),
			tags: Type.Optional(
				Type.Boolean({
					description:
						"Fetch all tags from the remote (--tags). Mutually exclusive with noTags.",
				}),
			),
			noTags: Type.Optional(
				Type.Boolean({
					description:
						"Do not fetch any tags from the remote (--no-tags). Mutually exclusive with tags.",
				}),
			),
			unshallow: Type.Optional(
				Type.Boolean({
					description:
						"Convert an existing shallow repository to a complete one (--unshallow). Cannot be combined with depth.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			if (params.all && (params.remote || params.branch)) {
				throw new Error(
					"'all' and 'remote'/'branch' are mutually exclusive. Use 'all' alone to fetch from all remotes.",
				);
			}
			if (params.unshallow && params.depth !== undefined) {
				throw new Error("'unshallow' and 'depth' are mutually exclusive.");
			}
			const args = ["fetch"];
			if (params.prune) args.push("--prune");
			if (params.tags && params.noTags) {
				throw new Error("'tags' and 'noTags' are mutually exclusive.");
			}
			if (params.tags) args.push("--tags");
			if (params.noTags) args.push("--no-tags");
			if (typeof params.depth === "number")
				args.push("--depth", String(params.depth));
			if (params.unshallow) args.push("--unshallow");
			if (params.all) args.push("--all");
			const remote = params.remote || (params.branch ? "origin" : undefined);
			if (remote) {
				validateRemoteName(remote, "fetch remote");
				args.push(remote);
			}
			if (params.branch) {
				validateBranchName(params.branch, "fetch branch");
				args.push(params.branch);
			}

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output }],
				details: {
					remote: params.all ? "all" : remote || "default",
					branch: params.branch || "all",
				},
			};
		},
	});
}
