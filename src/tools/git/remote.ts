/**
 * pi-git-tools — git_remote tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import {
	assertParamsValidForAction,
	validateRemoteName,
	validateRemoteUrl,
} from "../../validation.js";

/** Params valid per action; everything else present is rejected up front. */
const ACTION_PARAMS: Record<string, readonly string[]> = {
	list: [],
	add: ["name", "url"],
	remove: ["name"],
	rename: ["name", "newName"],
	"set-url": ["name", "url", "push", "add"],
	"get-url": ["name", "push"],
	"set-head": ["name"],
};

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_remote",
		label: "Git Remote",
		description:
			"Manage remote repositories: list, add, remove, rename, or change URLs.",
		promptSnippet: "Manage remotes",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("list"),
						Type.Literal("add"),
						Type.Literal("remove"),
						Type.Literal("rename"),
						Type.Literal("set-url"),
						Type.Literal("get-url"),
						Type.Literal("set-head"),
					],
					{
						description:
							"Action: 'list' (default), 'add', 'remove', 'rename', 'set-url', 'get-url', or 'set-head'.",
					},
				),
			),
			name: Type.Optional(
				Type.String({
					description:
						"Remote name (required for add/remove/rename/set-url/get-url, e.g. 'origin').",
				}),
			),
			url: Type.Optional(
				Type.String({
					description: "Remote URL (required for add/set-url).",
				}),
			),
			newName: Type.Optional(
				Type.String({
					description: "New remote name (for 'rename').",
				}),
			),
			push: Type.Optional(
				Type.Boolean({
					description: "Operate on the push URL (for 'set-url'/'get-url').",
				}),
			),
			add: Type.Optional(
				Type.Boolean({
					description:
						"Add a push URL instead of replacing (--add for 'set-url').",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "list";
			assertParamsValidForAction("git_remote", action, params, ACTION_PARAMS);

			switch (action) {
				case "list": {
					const args = ["remote", "-v"];
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output || "(no remotes)" }],
						details: { action: "list" },
					};
				}
				case "add": {
					if (!params.name)
						throw new Error("'name' is required to add a remote.");
					if (!params.url)
						throw new Error("'url' is required to add a remote.");
					validateRemoteName(params.name, "remote name");
					validateRemoteUrl(params.url, "remote url");
					await run(
						"git",
						["remote", "add", params.name, params.url],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Added remote '${params.name}' → ${params.url}.`,
							},
						],
						details: {
							action: "add",
							name: params.name,
							url: params.url,
						},
					};
				}
				case "remove": {
					if (!params.name)
						throw new Error("'name' is required to remove a remote.");
					validateRemoteName(params.name, "remote name");
					await run(
						"git",
						["remote", "remove", params.name],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Removed remote '${params.name}'.`,
							},
						],
						details: { action: "remove", name: params.name },
					};
				}
				case "rename": {
					if (!params.name)
						throw new Error("'name' is required to rename a remote.");
					if (!params.newName)
						throw new Error("'newName' is required to rename a remote.");
					validateRemoteName(params.name, "remote name");
					validateRemoteName(params.newName, "new remote name");
					await run(
						"git",
						["remote", "rename", params.name, params.newName],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Renamed remote '${params.name}' to '${params.newName}'.`,
							},
						],
						details: {
							action: "rename",
							name: params.name,
							newName: params.newName,
						},
					};
				}
				case "set-url": {
					if (!params.name)
						throw new Error("'name' is required to set a remote URL.");
					if (!params.url)
						throw new Error("'url' is required to set a remote URL.");
					validateRemoteName(params.name, "remote name");
					validateRemoteUrl(params.url, "remote url");
					const args = ["remote", "set-url"];
					if (params.push) args.push("--push");
					if (params.add) args.push("--add");
					args.push(params.name, params.url);
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Set URL for remote '${params.name}'.`,
							},
						],
						details: {
							action: "set-url",
							name: params.name,
							url: params.url,
							push: !!params.push,
							add: !!params.add,
						},
					};
				}
				case "get-url": {
					if (!params.name)
						throw new Error("'name' is required to get a remote URL.");
					validateRemoteName(params.name, "remote name");
					const args = ["remote", "get-url"];
					if (params.push) args.push("--push");
					args.push(params.name);
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output }],
						details: {
							action: "get-url",
							name: params.name,
							push: !!params.push,
						},
					};
				}
				case "set-head": {
					if (!params.name) throw new Error("'name' is required to set-head.");
					validateRemoteName(params.name, "remote name");
					const output = await run(
						"git",
						["remote", "set-head", params.name, "-a"],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: output || `Set HEAD for '${params.name}'.`,
							},
						],
						details: { action: "set-head", name: params.name },
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: list, add, remove, rename, set-url, get-url, set-head.`,
					);
			}
		},
	});
}
