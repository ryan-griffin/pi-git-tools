/**
 * pi-git-tools — dynamic tool loading.
 *
 * All tools stay registered (visible to `pi.getAllTools()`, the smoke
 * suite, and any introspection), but a lazy subset is removed from the
 * active set at `session_start`. The always-active loader tool
 * `git_tools_activate` adds them back additively via `pi.setActiveTools()`
 * — pi delivers the newly activated definitions at the tool-result
 * position on the next model request (native deferred loading on
 * Anthropic >= 4.5 / OpenAI gpt-5.4+; full active-list fallback on other
 * hosts, per extensions.md "Dynamic Tool Loading").
 *
 * The lazy split keeps the ~6k tokens of always-on core git tool schemas
 * (including the output-truncation policy suffix appended to every tool
 * description) in the prompt prefix and defers the other ~3.9k (rare git
 * operations + all GitHub tools, which need `gh` auth anyway) until the
 * model actually asks for them.
 *
 * Override the default split with `PI_GIT_TOOLS_ACTIVE`: a comma-separated
 * list of tool names and/or group names (`git-advanced`, `gh`), or `all`
 * to keep every tool active from the start.
 */

import type {
	AgentToolResult,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "./truncate.js";

/** Lazy tool catalog: one-line summary (loader description) + group. */
export interface ToolCatalogEntry {
	name: string;
	summary: string;
	group: string;
}

/** Details payload for the `git_tools_activate` tool result. */
export interface ActivateToolDetails {
	matches: string[];
	added: string[];
	alreadyActive: string[];
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
	{
		name: "git_apply",
		summary:
			"Apply a unified diff/patch (--3way, --reverse, --check, --cached)",
		group: "git-advanced",
	},
	{
		name: "git_blame",
		summary: "Line-by-line authorship for a file (blame)",
		group: "git-advanced",
	},
	{
		name: "git_cherry_pick",
		summary: "Cherry-pick commits onto the current branch",
		group: "git-advanced",
	},
	{
		name: "git_clean",
		summary: "Remove untracked files (dry-run, force, directories, exclude)",
		group: "git-advanced",
	},
	{
		name: "git_clone",
		summary: "Clone a repository (depth, branch, filter, submodules)",
		group: "git-advanced",
	},
	{
		name: "git_config",
		summary:
			"Get, set, add, unset, remove-section, list config (local/global/system)",
		group: "git-advanced",
	},
	{
		name: "git_init",
		summary:
			"Initialize a repository (bare, initial branch, object/ref format)",
		group: "git-advanced",
	},
	{
		name: "git_reflog",
		summary: "Show the reflog: where HEAD has pointed (recover lost commits)",
		group: "git-advanced",
	},
	{
		name: "git_revert",
		summary: "Revert a commit by creating an inverse commit",
		group: "git-advanced",
	},
	{
		name: "git_worktree",
		summary: "Manage multiple working trees (add, remove, prune, lock, unlock)",
		group: "git-advanced",
	},
	{
		name: "gh_api",
		summary:
			"Call any GitHub REST endpoint (method, data, params, field, paginate, silent)",
		group: "gh",
	},
	{
		name: "gh_issue",
		summary:
			"Manage GitHub issues (list, view, create, edit, close, reopen, comment)",
		group: "gh",
	},
	{
		name: "gh_pr",
		summary:
			"Manage GitHub pull requests (list, view, create, edit, merge, review, checks)",
		group: "gh",
	},
	{
		name: "gh_repo",
		summary:
			"GitHub repo info: view, list branches, list languages, open in browser",
		group: "gh",
	},
	{
		name: "gh_search",
		summary: "Search GitHub: repos, issues, PRs, code, commits",
		group: "gh",
	},
];

export const LAZY_TOOL_NAMES = TOOL_CATALOG.map((entry) => entry.name);
export const LAZY_TOOL_NAME_SET = new Set(LAZY_TOOL_NAMES);
export const GROUPS = [...new Set(TOOL_CATALOG.map((entry) => entry.group))];

const GROUP_TOOLS = new Map<string, string[]>();
for (const entry of TOOL_CATALOG) {
	const list = GROUP_TOOLS.get(entry.group) ?? [];
	list.push(entry.name);
	GROUP_TOOLS.set(entry.group, list);
}

/** `PI_GIT_TOOLS_ACTIVE` handling: "all" keeps everything; a set keeps
 * exactly those tools/groups; null means default (deactivate the lazy set). */
export function resolveActiveOverride(
	env: string | undefined,
): "all" | Set<string> | null {
	if (!env) return null;
	const trimmed = env.trim();
	if (!trimmed) return null;
	const parts = trimmed
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return null;
	if (parts.some((p) => p === "all")) return "all";
	const kept = new Set<string>();
	for (const part of parts) {
		const names = GROUP_TOOLS.get(part);
		if (names) {
			for (const name of names) kept.add(name);
		} else if (LAZY_TOOL_NAME_SET.has(part)) {
			kept.add(part);
		}
		// Unknown names are ignored — tools stay lazily available via the loader.
	}
	return kept;
}

/** Compute the tool names to deactivate for this process. */
export function toolsToDeactivate(env: string | undefined): Set<string> {
	const override = resolveActiveOverride(env);
	if (override === "all") return new Set();
	if (override) {
		return new Set(LAZY_TOOL_NAMES.filter((name) => !override.has(name)));
	}
	return new Set(LAZY_TOOL_NAMES);
}

/** Register the always-active loader tool. */
export function registerActivateTool(pi: ExtensionAPI) {
	const catalog = TOOL_CATALOG.map(
		(entry) => `${entry.name} — ${entry.summary} [${entry.group}]`,
	).join("\n");

	registerTool(pi, {
		name: "git_tools_activate",
		label: "Activate pi-git-tools",
		description:
			"Activate pi-git-tools tools that stay registered but inactive by default, so the default tool list stays lean. " +
			"Call this ONCE with the tools you need before using them — they become callable starting the NEXT turn. " +
			`Available:\n${catalog}`,
		promptSnippet: "Activate additional git/gh tools before using them",
		parameters: Type.Object(
			{
				tools: Type.Optional(
					Type.Array(Type.String({ enum: LAZY_TOOL_NAMES }), {
						minItems: 1,
						description:
							"Exact names of tools to activate (see this tool's description for the catalog).",
					}),
				),
				group: Type.Optional(
					Type.Union([
						Type.String({
							enum: GROUPS,
							description: "Group to activate: 'git-advanced' or 'gh'.",
						}),
						Type.Array(Type.String({ enum: GROUPS }), {
							minItems: 1,
							description:
								"One or more groups to activate in a single call (e.g. ['git-advanced', 'gh']).",
						}),
					]),
				),
			},
			{ additionalProperties: false },
		),
		async execute(
			_callId,
			params: { tools?: string[]; group?: string | string[] },
			_signal,
		): Promise<AgentToolResult<ActivateToolDetails>> {
			const requested = new Set<string>();
			if (Array.isArray(params.tools)) {
				for (const name of params.tools) {
					if (LAZY_TOOL_NAME_SET.has(name)) requested.add(name);
				}
			}
			const groups = Array.isArray(params.group)
				? params.group
				: params.group
					? [params.group]
					: [];
			for (const group of groups) {
				const names = GROUP_TOOLS.get(group);
				if (names) {
					for (const name of names) requested.add(name);
				}
			}
			if (requested.size === 0) {
				// Per the pi extension contract (docs/extensions.md "Signaling
				// errors"), failures must be signaled by throwing: returning a
				// value never sets the error flag, regardless of properties.
				throw new Error(
					`No valid tools given. Available: ${LAZY_TOOL_NAMES.join(", ")}`,
				);
			}

			const active = pi.getActiveTools();
			const already = [...requested].filter((name) => active.includes(name));
			const added = [...requested].filter((name) => !active.includes(name));
			if (added.length > 0) {
				// Additive only, per the dynamic-loading contract: never drop
				// currently active tools in the same call.
				pi.setActiveTools([...new Set([...active, ...added])]);
			}

			const parts: string[] = [];
			if (added.length > 0) parts.push(`Activated: ${added.join(", ")}`);
			if (already.length > 0)
				parts.push(`Already active: ${already.join(", ")}`);
			return {
				content: [
					{
						type: "text",
						text: `${parts.join(" ")} Available starting next turn.`,
					},
				],
				details: {
					matches: [...requested],
					added,
					alreadyActive: already,
				},
			};
		},
	});
}

/** Remove lazy tools from the active set at session start (feature-detected
 * for hosts without `getActiveTools`/`setActiveTools`). Honors the
 * `PI_GIT_TOOLS_ACTIVE` override. */
export function registerDeactivation(pi: ExtensionAPI) {
	if (
		typeof pi.getActiveTools !== "function" ||
		typeof pi.setActiveTools !== "function"
	) {
		return; // older host: everything stays statically active
	}
	pi.on("session_start", () => {
		try {
			const toRemove = toolsToDeactivate(process.env.PI_GIT_TOOLS_ACTIVE);
			if (toRemove.size === 0) return;
			const active = pi.getActiveTools();
			const kept = active.filter((name) => !toRemove.has(name));
			if (kept.length !== active.length) pi.setActiveTools(kept);
		} catch {
			// Non-fatal: leave the active set untouched on any host error.
		}
	});
}

/** Wire both halves: loader tool + session_start deactivation. */
export function wireDynamicTools(pi: ExtensionAPI) {
	registerActivateTool(pi);
	registerDeactivation(pi);
}
