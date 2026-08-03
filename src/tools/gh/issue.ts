/**
 * pi-git-tools — gh_issue tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { resolveCwd, run } from "../../utils.js";
import {
	findRepoRootBestEffort,
	formatGhAuthor,
	requireGh,
	resolveRepo,
} from "../gh-helpers.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "gh_issue",
		label: "GitHub Issue",
		description:
			"List, view, create, edit, close, reopen, or comment on GitHub issues via the gh CLI.",
		promptSnippet: "Manage GitHub issues",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("list"),
						Type.Literal("view"),
						Type.Literal("create"),
						Type.Literal("edit"),
						Type.Literal("close"),
						Type.Literal("reopen"),
						Type.Literal("comment"),
					],
					{
						description:
							"Action: 'list' (default), 'view', 'create', 'edit', 'close', 'reopen', or 'comment'.",
					},
				),
			),
			repo: Type.Optional(
				Type.String({
					description:
						"Repository in 'owner/repo' format. Defaults to the current git remote.",
				}),
			),
			number: Type.Optional(
				Type.Integer({
					description:
						"Issue number (required for view/edit/close/reopen/comment).",
					minimum: 1,
				}),
			),
			state: Type.Optional(
				Type.Union(
					[Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")],
					{
						description:
							"Filter by state for 'list': 'open' (default), 'closed', or 'all'.",
					},
				),
			),
			limit: Type.Optional(
				Type.Integer({
					description: "Max issues to list (default: 20, max: 100).",
					minimum: 1,
					maximum: 100,
				}),
			),
			title: Type.Optional(
				Type.String({
					description:
						"Issue title (required for 'create', optional for 'edit').",
				}),
			),
			body: Type.Optional(
				Type.String({
					description:
						"Issue body (for 'create'/'edit'/'comment'; close comment for 'close'). Defaults to empty string for create.",
				}),
			),
			label: Type.Optional(
				Type.String({
					description: "Issue labels (comma-separated, for 'create').",
				}),
			),
			assignee: Type.Optional(
				Type.String({
					description:
						"Assignee login(s), comma-separated (for 'create'). Use '@me' for self.",
				}),
			),
			addLabel: Type.Optional(
				Type.String({
					description: "Comma-separated labels to add (for 'edit').",
				}),
			),
			removeLabel: Type.Optional(
				Type.String({
					description: "Comma-separated labels to remove (for 'edit').",
				}),
			),
			addAssignee: Type.Optional(
				Type.String({
					description: "Comma-separated assignees to add (for 'edit').",
				}),
			),
			removeAssignee: Type.Optional(
				Type.String({
					description: "Comma-separated assignees to remove (for 'edit').",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRootBestEffort(cwd, _signal);
			await requireGh(root, _signal);
			const repo = await resolveRepo(params.repo, root, _signal);
			const action = params.action || "list";
			if (
				params.number !== undefined &&
				(!Number.isSafeInteger(params.number) || params.number < 1)
			) {
				throw new Error("'number' must be a positive integer.");
			}

			switch (action) {
				case "list": {
					const limit = Math.min(params.limit ?? 20, 100);
					const state = params.state || "open";
					const args = [
						"issue",
						"list",
						"--repo",
						repo,
						"--state",
						state,
						"--limit",
						String(limit),
						"--json",
						"number,title,author,state,createdAt,labels,url",
					];
					const output = await run("gh", args, root, undefined, _signal);
					let parsedIssues: unknown;
					try {
						parsedIssues = JSON.parse(output);
					} catch {
						return {
							content: [
								{
									type: "text",
									text: output || `No ${state} issues in ${repo}.`,
								},
							],
							details: { repo, state, count: 0 },
						};
					}
					if (!Array.isArray(parsedIssues)) {
						return {
							content: [
								{
									type: "text",
									text: output || `No ${state} issues in ${repo}.`,
								},
							],
							details: { repo, state, count: 0 },
						};
					}
					const issues = parsedIssues as Array<Record<string, unknown>>;
					if (issues.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: `No ${state} issues in ${repo}.`,
								},
							],
							details: { repo, state, count: 0 },
						};
					}
					const lines = issues.map((issue: Record<string, unknown>) => {
						const labels = Array.isArray(issue.labels)
							? (issue.labels as Array<Record<string, unknown>>)
									.map((l) => l.name)
									.join(", ")
							: "";
						const labelStr = labels ? ` [${labels}]` : "";
						const author = formatGhAuthor(issue.author);
						return `#${issue.number} ${issue.title} (@${author})${labelStr}\n   ${issue.url}`;
					});
					return {
						content: [
							{
								type: "text",
								text: `Issues in ${repo} (${state}):\n\n${lines.join("\n")}`,
							},
						],
						details: { repo, state, count: issues.length },
					};
				}
				case "view": {
					if (!params.number) throw new Error("'number' is required for view.");
					const args = [
						"issue",
						"view",
						String(params.number),
						"--repo",
						repo,
						"--json",
						"number,title,body,author,state,createdAt,closedAt,labels,comments,url,assignees",
					];
					const output = await run("gh", args, root, undefined, _signal);
					let text = output;
					try {
						const issue = JSON.parse(output) as Record<string, unknown>;
						const author = formatGhAuthor(issue.author);
						const labels = Array.isArray(issue.labels)
							? (issue.labels as Array<Record<string, unknown>>)
									.map((l) => l.name)
									.join(", ")
							: "";
						text = [
							`Issue #${issue.number}: ${issue.title}`,
							`State: ${issue.state} | Author: @${author}`,
							labels ? `Labels: ${labels}` : null,
							`URL: ${issue.url}`,
							"",
							String(issue.body || "(no body)"),
						]
							.filter((l) => l != null)
							.join("\n");
					} catch {
						// keep raw
					}
					return {
						content: [{ type: "text", text }],
						details: {
							repo,
							number: params.number,
							action: "view",
						},
					};
				}
				case "create": {
					if (!params.title)
						throw new Error("'title' is required to create an issue.");
					const body = params.body ?? "";
					const args = [
						"issue",
						"create",
						"--repo",
						repo,
						"--title",
						params.title,
						"--body",
						body,
					];
					if (params.label) {
						for (const l of params.label
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)) {
							args.push("--label", l);
						}
					}
					if (params.assignee) {
						for (const a of params.assignee
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)) {
							args.push("--assignee", a);
						}
					}

					// gh issue create prints the issue URL on success (no --json support)
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: output || `Created issue in ${repo}: ${params.title}`,
							},
						],
						details: {
							repo,
							action: "create",
							title: params.title,
							url: output.trim() || null,
						},
					};
				}
				case "close": {
					if (!params.number)
						throw new Error("'number' is required for close.");
					const args = [
						"issue",
						"close",
						String(params.number),
						"--repo",
						repo,
					];
					if (params.body !== undefined) args.push("--comment", params.body);
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: output || `Closed issue #${params.number} in ${repo}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "close",
							comment: params.body ?? null,
						},
					};
				}
				case "edit": {
					if (!params.number) throw new Error("'number' is required for edit.");
					const hasChange =
						params.title !== undefined ||
						params.body !== undefined ||
						params.addLabel !== undefined ||
						params.removeLabel !== undefined ||
						params.addAssignee !== undefined ||
						params.removeAssignee !== undefined;
					if (!hasChange) {
						throw new Error(
							"'edit' needs at least one change: title, body, addLabel/removeLabel, or addAssignee/removeAssignee.",
						);
					}
					const args = ["issue", "edit", String(params.number), "--repo", repo];
					if (params.title !== undefined) args.push("--title", params.title);
					if (params.body !== undefined) args.push("--body", params.body);
					for (const [flag, value] of [
						["--add-label", params.addLabel],
						["--remove-label", params.removeLabel],
						["--add-assignee", params.addAssignee],
						["--remove-assignee", params.removeAssignee],
					] as const) {
						if (value) {
							for (const item of value
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean)) {
								args.push(flag, item);
							}
						}
					}
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: output || `Edited issue #${params.number} in ${repo}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "edit",
						},
					};
				}
				case "reopen": {
					if (!params.number)
						throw new Error("'number' is required for reopen.");
					await run(
						"gh",
						["issue", "reopen", String(params.number), "--repo", repo],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Reopened issue #${params.number} in ${repo}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "reopen",
						},
					};
				}
				case "comment": {
					if (!params.number)
						throw new Error("'number' is required for comment.");
					if (!params.body) throw new Error("'body' is required for comment.");
					const output = await run(
						"gh",
						[
							"issue",
							"comment",
							String(params.number),
							"--repo",
							repo,
							"--body",
							params.body,
						],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: output || `Commented on issue #${params.number}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "comment",
						},
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: list, view, create, edit, close, reopen, comment.`,
					);
			}
		},
	});
}
