/**
 * pi-git-tools — gh_pr tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateBranchName, validateGhHeadRef } from "../../validation.js";
import { formatGhAuthor, requireGh, resolveRepo } from "../gh-helpers.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "gh_pr",
		label: "GitHub PR",
		description:
			"List, view, create, edit, checkout, merge, close, reopen, comment, review, diff, checks, or mark ready GitHub pull requests via the gh CLI.",
		promptSnippet: "Manage GitHub pull requests",
		parameters: Type.Object({
			action: Type.Optional(
				Type.Union(
					[
						Type.Literal("list"),
						Type.Literal("view"),
						Type.Literal("create"),
						Type.Literal("edit"),
						Type.Literal("checkout"),
						Type.Literal("merge"),
						Type.Literal("close"),
						Type.Literal("reopen"),
						Type.Literal("comment"),
						Type.Literal("review"),
						Type.Literal("diff"),
						Type.Literal("checks"),
						Type.Literal("ready"),
					],
					{
						description:
							"Action: 'list' (default), 'view', 'create', 'edit', 'checkout', 'merge', 'close', 'reopen', 'comment', 'review', 'diff', 'checks', or 'ready'.",
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
						"PR number (required for view/edit/checkout/merge/close/reopen/comment/review/diff/checks/ready).",
					minimum: 1,
				}),
			),
			state: Type.Optional(
				Type.Union(
					[
						Type.Literal("open"),
						Type.Literal("closed"),
						Type.Literal("merged"),
						Type.Literal("all"),
					],
					{
						description:
							"Filter by state for 'list': 'open' (default), 'closed', 'merged', or 'all'.",
					},
				),
			),
			limit: Type.Optional(
				Type.Integer({
					description: "Max PRs to list (default: 20, max: 100).",
					minimum: 1,
					maximum: 100,
				}),
			),
			title: Type.Optional(
				Type.String({
					description:
						"PR title (required for 'create' unless 'fill' is set; optional for 'edit').",
				}),
			),
			body: Type.Optional(
				Type.String({
					description:
						"PR body/description (for 'create'/'edit'/'comment'/'review'; close comment for 'close'). Defaults to empty string for create.",
				}),
			),
			fill: Type.Optional(
				Type.Boolean({
					description:
						"For 'create': derive title/body from the commits (--fill). Cannot be combined with 'title' or 'body'.",
				}),
			),
			head: Type.Optional(
				Type.String({
					description: "Head branch for 'create' (default: current branch).",
				}),
			),
			base: Type.Optional(
				Type.String({
					description:
						"Base branch for 'create' (default: the repo's default branch).",
				}),
			),
			draft: Type.Optional(
				Type.Boolean({
					description: "Create as draft PR.",
				}),
			),
			reviewer: Type.Optional(
				Type.String({
					description:
						"Comma-separated reviewer logins for 'create' (e.g. 'alice,bob').",
				}),
			),
			label: Type.Optional(
				Type.String({
					description: "Comma-separated labels for 'create'.",
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
			addReviewer: Type.Optional(
				Type.String({
					description: "Comma-separated reviewers to add (for 'edit').",
				}),
			),
			removeReviewer: Type.Optional(
				Type.String({
					description: "Comma-separated reviewers to remove (for 'edit').",
				}),
			),
			mergeMethod: Type.Optional(
				Type.String({
					description:
						"Merge method for 'merge': 'merge' (default), 'squash', or 'rebase'.",
				}),
			),
			deleteBranch: Type.Optional(
				Type.Boolean({
					description:
						"For 'merge': delete the head branch after merging (--delete-branch).",
				}),
			),
			reviewEvent: Type.Optional(
				Type.Union(
					[
						Type.Literal("approve"),
						Type.Literal("request-changes"),
						Type.Literal("comment"),
					],
					{
						description:
							"Review type for 'review': 'approve', 'request-changes', or 'comment' (default).",
					},
				),
			),
			nameOnly: Type.Optional(
				Type.Boolean({
					description: "For 'diff': show only changed file names.",
				}),
			),
			undo: Type.Optional(
				Type.Boolean({
					description: "For 'ready': convert PR back to draft (--undo).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal).catch(() => undefined);
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
						"pr",
						"list",
						"--repo",
						repo,
						"--state",
						state,
						"--limit",
						String(limit),
						"--json",
						"number,title,author,headRefName,baseRefName,state,createdAt,labels,url",
					];
					const output = await run("gh", args, root, undefined, _signal);
					let parsedPrs: unknown;
					try {
						parsedPrs = JSON.parse(output);
					} catch {
						return {
							content: [
								{
									type: "text",
									text: output || `No ${state} pull requests in ${repo}.`,
								},
							],
							details: { repo, state, count: 0 },
						};
					}
					if (!Array.isArray(parsedPrs)) {
						return {
							content: [
								{
									type: "text",
									text: output || `No ${state} pull requests in ${repo}.`,
								},
							],
							details: { repo, state, count: 0 },
						};
					}
					const prs = parsedPrs as Array<Record<string, unknown>>;
					if (prs.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: `No ${state} pull requests in ${repo}.`,
								},
							],
							details: { repo, state, count: 0 },
						};
					}
					const lines = prs.map((pr: Record<string, unknown>) => {
						const labels = Array.isArray(pr.labels)
							? (pr.labels as Array<Record<string, unknown>>)
									.map((l) => l.name)
									.join(", ")
							: "";
						const labelStr = labels ? ` [${labels}]` : "";
						const author = formatGhAuthor(pr.author);
						return `#${pr.number} ${pr.title} (@${author})${labelStr}\n   ${pr.url}`;
					});
					return {
						content: [
							{
								type: "text",
								text: `Pull Requests in ${repo} (${state}):\n\n${lines.join("\n")}`,
							},
						],
						details: { repo, state, count: prs.length },
					};
				}
				case "view": {
					if (!params.number) throw new Error("'number' is required for view.");
					const args = [
						"pr",
						"view",
						String(params.number),
						"--repo",
						repo,
						"--json",
						"number,title,body,author,state,headRefName,baseRefName,createdAt,mergedAt,closedAt,mergeable,additions,deletions,comments,files,url,reviewDecision,statusCheckRollup",
					];
					const output = await run("gh", args, root, undefined, _signal);
					let text = output;
					try {
						const pr = JSON.parse(output) as Record<string, unknown>;
						const author = formatGhAuthor(pr.author);
						text = [
							`PR #${pr.number}: ${pr.title}`,
							`State: ${pr.state} | Author: @${author}`,
							`Branch: ${pr.headRefName} → ${pr.baseRefName}`,
							`URL: ${pr.url}`,
							pr.mergeable != null ? `Mergeable: ${pr.mergeable}` : null,
							pr.reviewDecision ? `Review: ${pr.reviewDecision}` : null,
							`+${pr.additions ?? 0} / -${pr.deletions ?? 0}`,
							"",
							String(pr.body || "(no body)"),
						]
							.filter((l) => l != null)
							.join("\n");
					} catch {
						// keep raw output
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
					const title = params.title ?? "";
					if (!title && !params.fill) {
						throw new Error(
							"'title' is required to create a PR (or set 'fill' to derive it from commits).",
						);
					}
					if (params.fill && (params.title || params.body)) {
						throw new Error(
							"'fill' cannot be combined with 'title' or 'body'.",
						);
					}
					// gh requires --body non-interactively; default to empty
					const body = params.body ?? "";
					const args = ["pr", "create", "--repo", repo];
					if (params.fill) {
						args.push("--fill");
					} else {
						args.push("--title", title, "--body", body);
					}
					if (params.head) {
						// Accept plain branches and cross-repo 'owner:branch' heads (fork PRs).
						validateGhHeadRef(params.head, "PR head branch");
						args.push("--head", params.head);
					}
					if (params.base) {
						validateBranchName(params.base, "PR base branch");
						args.push("--base", params.base);
					}
					if (params.draft) args.push("--draft");
					if (params.reviewer) {
						for (const r of params.reviewer
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)) {
							args.push("--reviewer", r);
						}
					}
					if (params.label) {
						for (const l of params.label
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)) {
							args.push("--label", l);
						}
					}

					// gh pr create prints the PR URL on success (no --json support)
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: output || `Created PR in ${repo}: ${params.title}`,
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
				case "checkout": {
					if (!params.number)
						throw new Error("'number' is required for checkout.");
					const output = await run(
						"gh",
						["pr", "checkout", String(params.number), "--repo", repo],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: output || `Checked out PR #${params.number}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "checkout",
						},
					};
				}
				case "merge": {
					if (!params.number)
						throw new Error("'number' is required for merge.");
					const validMethods = ["merge", "squash", "rebase"];
					const mergeMethod = params.mergeMethod || "merge";
					if (!validMethods.includes(mergeMethod)) {
						throw new Error(
							`Invalid mergeMethod '${mergeMethod}'. Use one of: ${validMethods.join(", ")}`,
						);
					}
					const args = ["pr", "merge", String(params.number), "--repo", repo];
					if (mergeMethod === "squash") args.push("--squash");
					else if (mergeMethod === "rebase") args.push("--rebase");
					else args.push("--merge");
					if (params.deleteBranch) args.push("--delete-branch");
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: output || `Merged PR #${params.number}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "merge",
							mergeMethod,
							deleteBranch: !!params.deleteBranch,
						},
					};
				}
				case "edit": {
					if (!params.number) throw new Error("'number' is required for edit.");
					const hasChange =
						params.title !== undefined ||
						params.body !== undefined ||
						params.base !== undefined ||
						params.addLabel !== undefined ||
						params.removeLabel !== undefined ||
						params.addAssignee !== undefined ||
						params.removeAssignee !== undefined ||
						params.addReviewer !== undefined ||
						params.removeReviewer !== undefined;
					if (!hasChange) {
						throw new Error(
							"'edit' needs at least one change: title, body, base, addLabel/removeLabel, addAssignee/removeAssignee, or addReviewer/removeReviewer.",
						);
					}
					if (params.base) validateBranchName(params.base, "PR base branch");
					const args = ["pr", "edit", String(params.number), "--repo", repo];
					if (params.title !== undefined) args.push("--title", params.title);
					if (params.body !== undefined) args.push("--body", params.body);
					if (params.base !== undefined) args.push("--base", params.base);
					for (const [flag, value] of [
						["--add-label", params.addLabel],
						["--remove-label", params.removeLabel],
						["--add-assignee", params.addAssignee],
						["--remove-assignee", params.removeAssignee],
						["--add-reviewer", params.addReviewer],
						["--remove-reviewer", params.removeReviewer],
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
								text: output || `Edited PR #${params.number} in ${repo}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "edit",
						},
					};
				}
				case "close": {
					if (!params.number)
						throw new Error("'number' is required for close.");
					const args = ["pr", "close", String(params.number), "--repo", repo];
					if (params.body !== undefined) args.push("--comment", params.body);
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text: output || `Closed PR #${params.number} in ${repo}.`,
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
				case "reopen": {
					if (!params.number)
						throw new Error("'number' is required for reopen.");
					await run(
						"gh",
						["pr", "reopen", String(params.number), "--repo", repo],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Reopened PR #${params.number} in ${repo}.`,
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
							"pr",
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
								text: output || `Commented on PR #${params.number}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "comment",
						},
					};
				}
				case "review": {
					if (!params.number)
						throw new Error("'number' is required for review.");
					const event = params.reviewEvent || "comment";
					const args = ["pr", "review", String(params.number), "--repo", repo];
					if (event === "approve") args.push("--approve");
					else if (event === "request-changes") args.push("--request-changes");
					else args.push("--comment");
					if (params.body) args.push("--body", params.body);
					else if (event !== "approve") {
						throw new Error(
							"'body' is required for comment/request-changes reviews.",
						);
					}
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text:
									output ||
									`Submitted ${event} review on PR #${params.number}.`,
							},
						],
						details: {
							repo,
							number: params.number,
							action: "review",
							reviewEvent: event,
						},
					};
				}
				case "diff": {
					if (!params.number) throw new Error("'number' is required for diff.");
					const args = [
						"pr",
						"diff",
						String(params.number),
						"--repo",
						repo,
						"--color",
						"never",
					];
					if (params.nameOnly) args.push("--name-only");
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [{ type: "text", text: output || "(empty diff)" }],
						details: {
							repo,
							number: params.number,
							action: "diff",
							nameOnly: Boolean(params.nameOnly),
						},
					};
				}
				case "checks": {
					if (!params.number)
						throw new Error("'number' is required for checks.");
					const args = [
						"pr",
						"checks",
						String(params.number),
						"--repo",
						repo,
						"--json",
						"name,state,bucket,startedAt,completedAt,link",
					];
					const output = await run("gh", args, root, undefined, _signal);
					let text = output;
					try {
						const parsedChecks: unknown = JSON.parse(output);
						if (Array.isArray(parsedChecks)) {
							const checks = parsedChecks as Array<Record<string, unknown>>;
							if (checks.length === 0) {
								text = `No checks on PR #${params.number}.`;
							} else {
								text = checks
									.map((c) => {
										const bucket = c.bucket || c.state || "?";
										return `${bucket}  ${c.name}${c.link ? `\n   ${c.link}` : ""}`;
									})
									.join("\n");
							}
						}
					} catch {
						// keep raw
					}
					return {
						content: [{ type: "text", text }],
						details: {
							repo,
							number: params.number,
							action: "checks",
						},
					};
				}
				case "ready": {
					if (!params.number)
						throw new Error("'number' is required for ready.");
					const args = ["pr", "ready", String(params.number), "--repo", repo];
					if (params.undo) args.push("--undo");
					const output = await run("gh", args, root, undefined, _signal);
					return {
						content: [
							{
								type: "text",
								text:
									output ||
									(params.undo
										? `PR #${params.number} marked as draft.`
										: `PR #${params.number} marked ready for review.`),
							},
						],
						details: {
							repo,
							number: params.number,
							action: "ready",
							undo: Boolean(params.undo),
						},
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: list, view, create, checkout, merge, close, reopen, comment, review, diff, checks, ready.`,
					);
			}
		},
	});
}
