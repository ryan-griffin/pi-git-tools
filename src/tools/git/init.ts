/**
 * pi-git-tools — git_init tool registration.
 */
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveCwd, run } from "../../utils.js";
import {
	validateBranchName,
	validateDestinationPath,
} from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_init",
		label: "Git Init",
		description:
			"Create an empty git repository (or reinitialize an existing one). Supports bare repositories, a custom initial branch name, and object/ref formats. " +
			"Unlike most git tools, this does not require being inside an existing repository.",
		promptSnippet: "Initialize a git repository",
		parameters: Type.Object({
			directory: Type.Optional(
				Type.String({
					description:
						"Directory to initialize the repository in. Defaults to the current working directory.",
				}),
			),
			bare: Type.Optional(
				Type.Boolean({
					description:
						"Create a bare repository (no working tree), typically used as a shared remote (--bare).",
				}),
			),
			initialBranch: Type.Optional(
				Type.String({
					description:
						"Name for the initial branch before the first commit (--initial-branch), e.g. 'main'. Requires git >= 2.28.",
				}),
			),
			objectFormat: Type.Optional(
				Type.Union([Type.Literal("sha1"), Type.Literal("sha256")], {
					description:
						"Hash algorithm for object storage (--object-format). Defaults to the git default (sha1).",
				}),
			),
			refFormat: Type.Optional(
				Type.Union([Type.Literal("files"), Type.Literal("reftable")], {
					description:
						"Reference storage format (--ref-format). 'reftable' requires git >= 2.45.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			if (params.initialBranch) {
				validateBranchName(params.initialBranch, "initial branch");
			}
			if (params.directory) {
				validateDestinationPath(params.directory, "directory");
			}

			const args = ["init"];
			if (params.bare) args.push("--bare");
			if (params.initialBranch)
				args.push("--initial-branch", params.initialBranch);
			if (params.objectFormat)
				args.push(`--object-format=${params.objectFormat}`);
			if (params.refFormat) args.push(`--ref-format=${params.refFormat}`);
			if (params.directory) args.push("--", params.directory);

			const output = await run("git", args, cwd, undefined, _signal);
			const target = resolve(cwd ?? process.cwd(), params.directory ?? ".");
			return {
				content: [{ type: "text", text: output || "Repository initialized." }],
				details: {
					directory: target,
					bare: params.bare || false,
					initialBranch: params.initialBranch || null,
					objectFormat: params.objectFormat || null,
					refFormat: params.refFormat || null,
				},
			};
		},
	});
}
