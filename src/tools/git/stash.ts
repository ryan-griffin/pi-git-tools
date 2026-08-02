/**
 * pi-git-tools — git_stash tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_stash",
		label: "Git Stash",
		description:
			"Manage stashes: list, push (save), pop, apply, drop, or show a stash.",
		promptSnippet: "Manage stashes",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("list"),
						Type.Literal("push"),
						Type.Literal("pop"),
						Type.Literal("apply"),
						Type.Literal("drop"),
						Type.Literal("show"),
					],
					{
						description:
							"Action: 'list' (default), 'push', 'pop', 'apply', 'drop', or 'show'.",
					},
				),
			),
			message: Type.Optional(
				Type.String({
					description: "Optional message for 'push' action.",
				}),
			),
			index: Type.Optional(
				Type.Integer({
					description:
						"Stash index for pop/apply/drop/show (0-based, default: 0 for most recent).",
					minimum: 0,
				}),
			),
			patch: Type.Optional(
				Type.Boolean({
					description:
						"Show full diff (patch) instead of a summary (for 'show' action).",
				}),
			),
			includeUntracked: Type.Optional(
				Type.Boolean({
					description:
						"Include untracked files in the stash (for 'push' action).",
				}),
			),
			keepIndex: Type.Optional(
				Type.Boolean({
					description:
						"Keep the index intact while stashing (for 'push' action).",
				}),
			),
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Paths to stash selectively (for 'push' action, e.g. ['src/a.ts', 'test/']). Everything else stays in the working tree.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "list";
			const idx =
				typeof params.index === "number"
					? `stash@{${params.index}}`
					: undefined;

			switch (action) {
				case "list": {
					const output = await run(
						"git",
						["stash", "list"],
						root,
						undefined,
						_signal,
					);
					return {
						content: [{ type: "text", text: output || "(no stashes)" }],
						details: {
							action: "list",
							count: output ? output.split("\n").length : 0,
						},
					};
				}
				case "push": {
					const args = ["stash", "push"];
					if (params.keepIndex) args.push("--keep-index");
					if (params.includeUntracked) args.push("--include-untracked");
					if (params.message) args.push("-m", params.message);
					if (params.paths && params.paths.length > 0) {
						for (const p of params.paths) validateGitPath(p, "stash path");
						args.push("--", ...params.paths);
					}
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: output || "Changes stashed.",
							},
						],
						details: {
							action: "push",
							message: params.message || null,
							pathCount: params.paths?.length ?? 0,
						},
					};
				}
				case "pop": {
					if (params.keepIndex || params.includeUntracked) {
						throw new Error(
							"includeUntracked and keepIndex are only valid for stash push.",
						);
					}
					if (params.paths?.length) {
						throw new Error("'paths' is only valid for stash push.");
					}
					const args = ["stash", "pop"];
					if (idx) args.push(idx);
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output }],
						details: { action: "pop", index: params.index ?? 0 },
					};
				}
				case "apply": {
					if (params.keepIndex || params.includeUntracked) {
						throw new Error(
							"includeUntracked and keepIndex are only valid for stash push.",
						);
					}
					if (params.paths?.length) {
						throw new Error("'paths' is only valid for stash push.");
					}
					const args = ["stash", "apply"];
					if (idx) args.push(idx);
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output }],
						details: { action: "apply", index: params.index ?? 0 },
					};
				}
				case "drop": {
					const args = ["stash", "drop"];
					if (idx) args.push(idx);
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output }],
						details: { action: "drop", index: params.index ?? 0 },
					};
				}
				case "show": {
					const args = ["stash", "show"];
					if (params.patch) args.push("-p");
					if (idx) args.push(idx);
					const output = await run("git", args, root, undefined, _signal);
					if (!output) {
						return {
							content: [{ type: "text", text: "Stash is empty." }],
							details: { action: "show", empty: true },
						};
					}
					return {
						content: [{ type: "text", text: output }],
						details: { action: "show", index: params.index ?? 0 },
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: list, push, pop, apply, drop, show.`,
					);
			}
		},
	});
}
