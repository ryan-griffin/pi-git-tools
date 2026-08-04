/**
 * pi-git-tools — git_worktree tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import {
	assertParamsValidForAction,
	validateBranchName,
	validateCommitish,
	validateDestinationPath,
} from "../../validation.js";

/** Params valid per action; everything else present is rejected up front. */
const ACTION_PARAMS: Record<string, readonly string[]> = {
	list: [],
	add: ["path", "branch", "detach", "force"],
	remove: ["path", "force"],
	prune: [],
	lock: ["path"],
	unlock: ["path"],
};

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_worktree",
		label: "Git Worktree",
		description:
			"Manage multiple working trees attached to the same repository. Supports add, list, remove, prune, lock, and unlock operations.",
		promptSnippet: "Manage working trees",
		parameters: Type.Object(
			{
				action: Type.Optional(
					Type.Union(
						[
							Type.Literal("list"),
							Type.Literal("add"),
							Type.Literal("remove"),
							Type.Literal("prune"),
							Type.Literal("lock"),
							Type.Literal("unlock"),
						],
						{
							description:
								"Action: 'list' (default), 'add', 'remove', 'prune', 'lock', or 'unlock'.",
						},
					),
				),
				path: Type.Optional(
					Type.String({
						description: "Path for the new worktree (required for 'add').",
					}),
				),
				branch: Type.Optional(
					Type.String({
						description:
							"Branch name for the new worktree (for 'add'). Creates a new branch with -b. " +
							"With detach: true, treated as an existing ref for detached HEAD instead. " +
							"Defaults to a name derived from the path.",
					}),
				),
				detach: Type.Optional(
					Type.Boolean({
						description:
							"Check out a detached HEAD at the given ref instead of creating a new branch (for 'add').",
					}),
				),
				force: Type.Optional(
					Type.Boolean({
						description:
							"Force operation (for 'remove' or 'add' with --force).",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const action = params.action || "list";
			assertParamsValidForAction("git_worktree", action, params, ACTION_PARAMS);

			switch (action) {
				case "list": {
					const output = await run(
						"git",
						["worktree", "list"],
						root,
						undefined,
						_signal,
					);
					return {
						content: [{ type: "text", text: output || "(no worktrees)" }],
						details: {
							action: "list",
							worktrees: output ? output.split("\n").length : 0,
						},
					};
				}
				case "add": {
					if (!params.path)
						throw new Error("'path' is required to add a worktree.");
					// Pass the path through verbatim (no trim): paths may legitimately
					// end in spaces/tabs, and silently altering them would corrupt the
					// requested destination (see utils.ts stripTrailingTerminator).
					// Matches git_clone/git_init.
					const wkPath = validateDestinationPath(params.path, "worktree path");
					if (params.branch) {
						if (params.detach) validateCommitish(params.branch, "branch");
						else validateBranchName(params.branch, "branch");
					}
					const args = ["worktree", "add"];
					if (params.force) args.push("--force");
					if (params.detach) {
						args.push("--detach");
						args.push(wkPath);
						if (params.branch) args.push(params.branch);
					} else if (params.branch) {
						args.push("-b", params.branch);
						args.push(wkPath);
					} else {
						args.push(wkPath);
					}
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output }],
						details: {
							action: "add",
							path: wkPath,
							branch:
								params.branch || (params.detach ? "(detached)" : "(default)"),
						},
					};
				}
				case "remove": {
					if (!params.path)
						throw new Error("'path' is required to remove a worktree.");
					const wkPath = validateDestinationPath(params.path, "worktree path");
					const args = ["worktree", "remove"];
					if (params.force) args.push("--force");
					args.push(wkPath);
					const output = await run("git", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output }],
						details: { action: "remove", path: wkPath },
					};
				}
				case "prune": {
					const output = await run(
						"git",
						["worktree", "prune"],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: output || "Pruned stale worktree references.",
							},
						],
						details: { action: "prune" },
					};
				}
				case "lock": {
					if (!params.path)
						throw new Error("'path' is required to lock a worktree.");
					const wkPath = validateDestinationPath(params.path, "worktree path");
					await run(
						"git",
						["worktree", "lock", wkPath],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Locked worktree at '${wkPath}'.`,
							},
						],
						details: { action: "lock", path: wkPath },
					};
				}
				case "unlock": {
					if (!params.path)
						throw new Error("'path' is required to unlock a worktree.");
					const wkPath = validateDestinationPath(params.path, "worktree path");
					await run(
						"git",
						["worktree", "unlock", wkPath],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Unlocked worktree at '${wkPath}'.`,
							},
						],
						details: { action: "unlock", path: wkPath },
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: list, add, remove, prune, lock, unlock.`,
					);
			}
		},
	});
}
