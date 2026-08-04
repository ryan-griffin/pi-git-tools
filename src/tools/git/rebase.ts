/**
 * pi-git-tools — git_rebase tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import {
	assertParamsValidForAction,
	validateCommitish,
} from "../../validation.js";

/** Params valid per action; everything else present is rejected up front. */
const ACTION_PARAMS: Record<string, readonly string[]> = {
	rebase: ["onto", "interactive", "autosquash"],
	continue: [],
	abort: [],
	skip: [],
};

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_rebase",
		label: "Git Rebase",
		description:
			"Rebase the current branch onto another branch, or continue/abort/skip an in-progress rebase. " +
			"Supports autosquash. Interactive rebase is not available headlessly.",
		promptSnippet: "Rebase onto another branch",
		parameters: Type.Object(
			{
				action: Type.Optional(
					Type.Union(
						[
							Type.Literal("rebase"),
							Type.Literal("continue"),
							Type.Literal("abort"),
							Type.Literal("skip"),
						],
						{
							description:
								"Action: 'rebase' (default), 'continue', 'abort', or 'skip' (during conflict).",
						},
					),
				),
				onto: Type.Optional(
					Type.String({
						description:
							"Branch or ref to rebase onto (e.g. 'main', 'HEAD~3'). Required for action=rebase.",
					}),
				),
				interactive: Type.Optional(
					Type.Boolean({
						description:
							"Use interactive rebase. Not supported headlessly — will error if true.",
					}),
				),
				autosquash: Type.Optional(
					Type.Boolean({
						description: "Automatically squash fixup/squash commits.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "rebase";
			assertParamsValidForAction("git_rebase", action, params, ACTION_PARAMS);

			if (action === "abort") {
				const output = await run(
					"git",
					["rebase", "--abort"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [{ type: "text", text: output || "Rebase aborted." }],
					details: { action: "abort" },
				};
			}
			if (action === "continue") {
				const output = await run(
					"git",
					["rebase", "--continue"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [{ type: "text", text: output || "Rebase continued." }],
					details: { action: "continue" },
				};
			}
			if (action === "skip") {
				const output = await run(
					"git",
					["rebase", "--skip"],
					root,
					undefined,
					_signal,
				);
				return {
					content: [
						{
							type: "text",
							text: output || "Rebase skipped current commit.",
						},
					],
					details: { action: "skip" },
				};
			}

			if (params.interactive) {
				throw new Error(
					"Interactive rebase is not supported in headless environments. " +
						"Use autosquash: true with fixup!/squash! commits, or run this manually.",
				);
			}
			if (!params.onto)
				throw new Error("'onto' is required to start a rebase.");
			const args = ["rebase"];
			if (params.autosquash) args.push("--autosquash");
			validateCommitish(params.onto, "rebase onto");
			args.push(params.onto);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "Rebase completed." }],
				details: {
					action: "rebase",
					onto: params.onto,
					autosquash: Boolean(params.autosquash),
				},
			};
		},
	});
}
