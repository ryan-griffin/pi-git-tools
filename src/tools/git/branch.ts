/**
 * pi-git-tools — git_branch tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import {
	assertParamsValidForAction,
	validateBranchName,
	validateCommitish,
} from "../../validation.js";

/** Params valid per action; everything else present is rejected up front. */
const ACTION_PARAMS: Record<string, readonly string[]> = {
	list: ["remote"],
	create: ["name", "force", "startPoint", "checkout"],
	delete: ["name", "force"],
	rename: ["name", "newName"],
	switch: ["name", "force", "track"],
};

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_branch",
		label: "Git Branch",
		description:
			"List, create, rename, or delete branches. Lists all local branches by default.",
		promptSnippet: "Manage branches",
		parameters: Type.Object(
			{
				action: Type.Optional(
					Type.Union(
						[
							Type.Literal("list"),
							Type.Literal("create"),
							Type.Literal("delete"),
							Type.Literal("rename"),
							Type.Literal("switch"),
						],
						{
							description:
								"Action: 'list' (default), 'create', 'delete', 'rename', or 'switch'.",
						},
					),
				),
				name: Type.Optional(
					Type.String({
						description:
							"Branch name (required for create/delete/switch; old name for rename).",
					}),
				),
				newName: Type.Optional(
					Type.String({
						description:
							"New name for 'rename' action. When omitted, the CURRENT branch is renamed to 'name'.",
					}),
				),
				remote: Type.Optional(
					Type.Boolean({
						description: "Include remote branches when listing.",
					}),
				),
				force: Type.Optional(
					Type.Boolean({
						description:
							"Force delete (-D), force-create, or force-switch (discards local changes) — use with caution.",
					}),
				),
				startPoint: Type.Optional(
					Type.String({
						description:
							"Start point (commit-ish) for 'create' (e.g. 'main', 'HEAD~3', 'origin/main').",
					}),
				),
				checkout: Type.Optional(
					Type.Boolean({
						description:
							"After 'create', switch to the new branch (git switch -c). Default: false.",
					}),
				),
				track: Type.Optional(
					Type.Boolean({
						description:
							"For 'switch': set up tracking when switching to a remote-tracking branch (e.g. origin/foo).",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "list";
			assertParamsValidForAction("git_branch", action, params, ACTION_PARAMS);

			switch (action) {
				case "list": {
					const args = ["branch", "-vv"];
					if (params.remote) args.push("-a");
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output || "(no branches)" }],
						details: { action: "list" },
					};
				}
				case "create": {
					if (!params.name)
						throw new Error("'name' is required to create a branch.");
					validateBranchName(params.name, "branch name");
					if (params.startPoint)
						validateCommitish(params.startPoint, "startPoint");
					if (params.checkout) {
						await run(
							"git",
							[
								"switch",
								...(params.force ? ["--force"] : []),
								"-c",
								params.name,
								...(params.startPoint ? [params.startPoint] : []),
							],
							root,
							undefined,
							_signal,
						);
						return {
							content: [
								{
									type: "text",
									text: `Created and switched to branch '${params.name}'.`,
								},
							],
							details: {
								action: "create",
								name: params.name,
								checkout: true,
								startPoint: params.startPoint || null,
							},
						};
					}
					const branchArgs = ["branch"];
					if (params.force) branchArgs.push("-f");
					branchArgs.push(params.name);
					if (params.startPoint) branchArgs.push(params.startPoint);
					await run("git", branchArgs, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Created branch '${params.name}'.`,
							},
						],
						details: {
							action: "create",
							name: params.name,
							startPoint: params.startPoint || null,
						},
					};
				}
				case "delete": {
					if (!params.name)
						throw new Error("'name' is required to delete a branch.");
					validateBranchName(params.name, "branch name");
					const args = ["branch"];
					if (params.force) {
						args.push("-D");
					} else {
						args.push("-d");
					}
					args.push(params.name);
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Deleted branch '${params.name}'.`,
							},
						],
						details: { action: "delete", name: params.name },
					};
				}
				case "rename": {
					if (!params.name) throw new Error("'name' is required to rename.");
					validateBranchName(params.name, "branch name");
					if (params.newName) {
						validateBranchName(params.newName, "new branch name");
					}
					const args = ["branch", "-m"];
					if (params.newName) {
						args.push(params.name, params.newName);
						await run("git", args, root, undefined, _signal);
						return {
							content: [
								{
									type: "text",
									text: `Renamed '${params.name}' to '${params.newName}'.`,
								},
							],
							details: {
								action: "rename",
								name: params.name,
								newName: params.newName,
							},
						};
					}
					// Rename current branch: params.name is the new name
					args.push(params.name);
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Renamed current branch to '${params.name}'.`,
							},
						],
						details: { action: "rename", name: params.name },
					};
				}
				case "switch": {
					if (!params.name)
						throw new Error("'name' is required to switch branches.");
					validateBranchName(params.name, "branch name");
					const switchArgs = ["switch"];
					if (params.force) switchArgs.push("--force");
					if (params.track) switchArgs.push("--track");
					switchArgs.push(params.name);
					await run("git", switchArgs, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Switched to branch '${params.name}'.`,
							},
						],
						details: {
							action: "switch",
							name: params.name,
							track: !!params.track,
						},
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: list, create, delete, rename, switch.`,
					);
			}
		},
	});
}
