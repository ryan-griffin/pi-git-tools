/**
 * pi-git-tools — git_config tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateLine } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import {
	assertParamsValidForAction,
	validateConfigKey,
} from "../../validation.js";

/** Params valid per action; everything else present is rejected up front. */
const ACTION_PARAMS: Record<string, readonly string[]> = {
	get: ["name", "scope", "type"],
	set: ["name", "value", "scope", "type"],
	list: ["name", "scope"],
	unset: ["name", "scope"],
	add: ["name", "value", "scope"],
	"unset-all": ["name", "value", "scope"],
	"remove-section": ["name", "scope"],
};

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_config",
		label: "Git Config",
		description:
			"Get, set, add, list, unset, or remove git configuration values. Supports local, global, and system scopes.",
		promptSnippet: "Manage git configuration",
		parameters: Type.Object(
			{
				action: Type.Optional(
					Type.Union(
						[
							Type.Literal("get"),
							Type.Literal("set"),
							Type.Literal("list"),
							Type.Literal("unset"),
							Type.Literal("add"),
							Type.Literal("unset-all"),
							Type.Literal("remove-section"),
						],
						{
							description:
								"Action: 'get' (default), 'set', 'list', 'unset', 'add', 'unset-all', or 'remove-section'.",
						},
					),
				),
				name: Type.Optional(
					Type.String({
						description:
							"Config key name (e.g. 'user.name', 'user.email'). Required for get/set/unset.",
					}),
				),
				value: Type.Optional(
					Type.String({
						description:
							"Config value (required for 'set'/'add'; optional regex filter for 'unset-all').",
					}),
				),
				scope: Type.Optional(
					Type.Union(
						[
							Type.Literal("local"),
							Type.Literal("global"),
							Type.Literal("system"),
						],
						{
							description:
								"Config scope: 'local' (default), 'global', or 'system'.",
						},
					),
				),
				type: Type.Optional(
					Type.Union(
						[
							Type.Literal("bool"),
							Type.Literal("int"),
							Type.Literal("path"),
							Type.Literal("expiry-date"),
							Type.Literal("color"),
						],
						{
							description:
								"Value type hint: 'bool', 'int', 'path', 'expiry-date', 'color'.",
						},
					),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const action = params.action || "get";
			assertParamsValidForAction("git_config", action, params, ACTION_PARAMS);
			const scope = params.scope || "local";

			const validScopes = ["local", "global", "system"];
			if (!validScopes.includes(scope)) {
				throw new Error(
					`Invalid scope '${scope}'. Use one of: ${validScopes.join(", ")}`,
				);
			}

			const scopeMap: Record<string, string> = {
				local: "--local",
				global: "--global",
				system: "--system",
			};
			const scopeFlag = scopeMap[scope] || "--system";
			const root = scope === "local" ? await findRepoRoot(cwd, _signal) : cwd;

			switch (action) {
				case "get": {
					if (!params.name) throw new Error("'name' is required for 'get'.");
					validateConfigKey(params.name, "config key");
					if (
						params.type &&
						!["bool", "int", "path", "expiry-date", "color"].includes(
							params.type,
						)
					) {
						throw new Error(
							`Invalid config type ${params.type}. Valid: bool, int, path, expiry-date, color`,
						);
					}
					const args = ["config", scopeFlag];
					if (params.type) args.push("--type", params.type);
					args.push("--get", params.name);
					let output: string;
					try {
						output = await run("git", args, root, undefined, _signal);
						return {
							content: [{ type: "text", text: output }],
							details: {
								action: "get",
								name: params.name,
								scope,
								// Avoid duplicating a potentially huge value in details:
								// the full value is already the tool's content text.
								value: truncateLine(output, 4000).text,
							},
						};
					} catch (err: unknown) {
						if (
							err instanceof Error &&
							(("exitCode" in err &&
								(err as { exitCode?: number | string }).exitCode === 1) ||
								err.message.includes("key does not exist") ||
								err.message.includes("key does not contain"))
						) {
							return {
								content: [
									{
										type: "text",
										text: `Config key '${params.name}' is not set in ${scope} scope.`,
									},
								],
								details: {
									action: "get",
									name: params.name,
									scope,
									found: false,
								},
							};
						}
						throw err;
					}
				}
				case "set": {
					if (!params.name) throw new Error("'name' is required for 'set'.");
					if (params.value === undefined)
						throw new Error("'value' is required for 'set'.");
					validateConfigKey(params.name, "config key");
					if (
						params.type &&
						!["bool", "int", "path", "expiry-date", "color"].includes(
							params.type,
						)
					) {
						throw new Error(
							`Invalid config type ${params.type}. Valid: bool, int, path, expiry-date, color`,
						);
					}
					const args = ["config", scopeFlag];
					if (params.type) args.push("--type", params.type);
					args.push(params.name, params.value);
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Set ${scope} config '${params.name}' = '${params.value}'.`,
							},
						],
						details: {
							action: "set",
							name: params.name,
							value: params.value,
							scope,
						},
					};
				}
				case "unset": {
					if (!params.name) throw new Error("'name' is required for 'unset'.");
					validateConfigKey(params.name, "config key");
					const args = ["config", scopeFlag, "--unset", params.name];
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Unset ${scope} config '${params.name}'.`,
							},
						],
						details: {
							action: "unset",
							name: params.name,
							scope,
						},
					};
				}
				case "add": {
					if (!params.name) throw new Error("'name' is required for 'add'.");
					if (params.value === undefined)
						throw new Error("'value' is required for 'add'.");
					validateConfigKey(params.name, "config key");
					const args = [
						"config",
						scopeFlag,
						"--add",
						params.name,
						params.value,
					];
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Added ${scope} config '${params.name}' = '${params.value}'.`,
							},
						],
						details: {
							action: "add",
							name: params.name,
							value: params.value,
							scope,
						},
					};
				}
				case "unset-all": {
					if (!params.name)
						throw new Error("'name' is required for 'unset-all'.");
					validateConfigKey(params.name, "config key");
					const args = ["config", scopeFlag, "--unset-all", params.name];
					if (params.value !== undefined) args.push(params.value);
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Unset all ${scope} config values for '${params.name}'.`,
							},
						],
						details: {
							action: "unset-all",
							name: params.name,
							scope,
						},
					};
				}
				case "remove-section": {
					if (!params.name)
						throw new Error("'name' is required for 'remove-section'.");
					if (!/^[a-zA-Z0-9.-]+$/.test(params.name)) {
						throw new Error(
							"Section name must contain only letters, digits, '.', and '-'.",
						);
					}
					const args = ["config", scopeFlag, "--remove-section", params.name];
					await run("git", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: `Removed ${scope} config section '${params.name}'.`,
							},
						],
						details: {
							action: "remove-section",
							name: params.name,
							scope,
						},
					};
				}
				case "list": {
					// --list and --get are mutually exclusive in git config
					const args = ["config", scopeFlag];
					if (params.name) {
						validateConfigKey(params.name, "config key");
						// --get-regexp allows prefix/partial filter while listing matches
						args.push("--get-regexp", params.name);
					} else {
						args.push("--list");
					}
					let output = "";
					try {
						output = await run("git", args, root, undefined, _signal);
					} catch (err: unknown) {
						// --get-regexp exits 1 when no matches (often empty stderr)
						if (!params.name) throw err;
						if (!(err instanceof Error)) throw err;
						if (
							err.message.trim() &&
							!(
								"exitCode" in err &&
								(err as { exitCode?: number | string }).exitCode === 1
							) &&
							!/key does not|not found|no such|unable to read/i.test(
								err.message,
							)
						) {
							throw err;
						}
						output = "";
					}
					return {
						content: [
							{
								type: "text",
								text: output || `(no ${scope} config entries)`,
							},
						],
						details: {
							action: "list",
							scope,
							count: output ? output.split("\n").filter(Boolean).length : 0,
						},
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: get, set, list, unset, add, unset-all, remove-section.`,
					);
			}
		},
	});
}
