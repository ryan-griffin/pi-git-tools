/**
 * pi-git-tools — git_tag tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import {
	assertParamsValidForAction,
	validateCommandValue,
	validateCommitish,
	validateTagName,
} from "../../validation.js";

/** Params valid per action; everything else present is rejected up front. */
const ACTION_PARAMS: Record<string, readonly string[]> = {
	list: ["listPattern"],
	create: ["name", "target", "message", "force", "sign"],
	delete: ["name"],
	verify: ["name"],
};

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_tag",
		label: "Git Tag",
		description:
			"Create, list, delete, or verify tags. Supports lightweight and annotated tags.",
		promptSnippet: "Manage tags",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("list"),
						Type.Literal("create"),
						Type.Literal("delete"),
						Type.Literal("verify"),
					],
					{
						description:
							"Action: 'list' (default), 'create', 'delete', or 'verify'.",
					},
				),
			),
			name: Type.Optional(
				Type.String({
					description: "Tag name (required for create/delete/verify).",
				}),
			),
			target: Type.Optional(
				Type.String({
					description:
						"Commit, branch, or ref to tag (for 'create'). Defaults to HEAD.",
				}),
			),
			message: Type.Optional(
				Type.String({
					description:
						"Annotation message for an annotated tag (for 'create'). Omit for a lightweight tag.",
				}),
			),
			force: Type.Optional(
				Type.Boolean({
					description:
						"Force-create the tag over an existing one (-f). Only for 'create' action.",
				}),
			),
			sign: Type.Optional(
				Type.Boolean({
					description: "GPG-sign the tag (-s). Only for 'create' action.",
				}),
			),
			listPattern: Type.Optional(
				Type.String({
					description:
						"Only list tags matching this pattern (-l, e.g. 'v2.*'). For 'list' action.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "list";
			assertParamsValidForAction("git_tag", action, params, ACTION_PARAMS);

			switch (action) {
				case "list": {
					const args = ["tag", "--list", "--sort=-creatordate"];
					if (params.listPattern) {
						validateCommandValue(params.listPattern, "tag list pattern");
						args.push("--", params.listPattern);
					}
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output || "(no tags)" }],
						details: {
							action: "list",
							count: output ? output.split("\n").filter(Boolean).length : 0,
						},
					};
				}
				case "create": {
					if (!params.name)
						throw new Error("'name' is required to create a tag.");
					validateTagName(params.name, "tag name");
					if (params.sign && !params.message) {
						throw new Error("'message' is required when signing a tag.");
					}
					if (params.target) validateCommitish(params.target, "tag target");
					const args = ["tag"];
					if (params.force) args.push("-f");
					if (params.sign) args.push("-s");
					if (params.message) {
						args.push("-a", params.name, "-m", params.message);
					} else {
						args.push(params.name);
					}
					if (params.target) args.push(params.target);
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Created tag '${params.name}'.`,
							},
						],
						details: {
							action: "create",
							name: params.name,
							annotated: Boolean(params.message),
						},
					};
				}
				case "delete": {
					if (!params.name)
						throw new Error("'name' is required to delete a tag.");
					validateTagName(params.name, "tag name");
					const args = ["tag", "-d", "--", params.name];
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Deleted tag '${params.name}'.`,
							},
						],
						details: { action: "delete", name: params.name },
					};
				}
				case "verify": {
					if (!params.name)
						throw new Error("'name' is required to verify a tag.");
					validateTagName(params.name, "tag name");
					const args = ["tag", "-v", "--", params.name];
					let output: string;
					try {
						output = await run("git", args, root, undefined, _signal);
					} catch (err: unknown) {
						// git exits 1 on lightweight tags with a raw "cannot verify" line;
						// rephrase it so the caller knows how to fix it.
						if (
							err instanceof Error &&
							err.message.includes("cannot verify a non-tag object")
						) {
							throw new Error(
								`Tag '${params.name}' is lightweight and cannot be GPG-verified. ` +
									'Only annotated tags (create with message: "...") can be verified.',
							);
						}
						throw err;
					}
					return {
						content: [{ type: "text", text: output }],
						details: { action: "verify", name: params.name },
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: list, create, delete, verify.`,
					);
			}
		},
	});
}
