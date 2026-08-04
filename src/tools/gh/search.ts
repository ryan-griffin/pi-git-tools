/**
 * pi-git-tools — gh_search tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { resolveCwd, run } from "../../utils.js";
import { validateRepo, validateSearchQuery } from "../../validation.js";
import {
	findRepoRootBestEffort,
	formatGhAuthor,
	requireGh,
} from "../gh-helpers.js";

/** Get JSON fields for a given gh search type. */
function getSearchFields(type: string): string {
	switch (type) {
		case "repo": {
			return "name,owner,description,url,stargazersCount,forksCount,language,updatedAt,openIssuesCount";
		}
		case "issue":
		case "pr": {
			return "number,title,state,author,repository,url,createdAt";
		}
		case "code": {
			return "repository,path,sha,url,textMatches";
		}
		case "commit": {
			return "sha,author,repository,url,commit";
		}
		default: {
			return "url";
		}
	}
}

/**
 * Build the argv for `gh search`. All flags are placed BEFORE the query so a
 * hyphen-prefixed query (GitHub negation syntax, e.g. '-topic:linux' or
 * '-label:bug') cannot be misread as a flag by gh's parser; the trailing '--'
 * marks the query as positional. The separator must stay the last element:
 * gh treats everything after '--' as the query, so no flag may follow it.
 */
export function buildSearchArgs(
	searchType: string,
	resultType: string,
	query: string,
	limit: number,
	sort?: string,
	order?: string,
): string[] {
	const args = [
		"search",
		searchType,
		"--limit",
		String(limit),
		"--json",
		getSearchFields(resultType),
	];
	if (sort && sort !== "best-match") {
		args.push("--sort", sort);
	}
	if (order) {
		args.push("--order", order);
	}
	args.push("--", query);
	return args;
}

/** Format search results for human readability. */
function formatSearchResults(
	results: Array<Record<string, unknown>>,
	type: string,
): string {
	const lines: string[] = [];
	for (const r of results) {
		switch (type) {
			case "repo": {
				const owner = (r.owner as Record<string, unknown>)?.login || "?";
				const lang = r.language ? ` [${r.language}]` : "";
				const stars = r.stargazersCount ? ` ★${r.stargazersCount}` : "";
				lines.push(
					`${owner}/${r.name}${stars}${lang}`,
					`  ${r.description || "(no description)"}`,
					`  ${r.url}`,
					"",
				);
				break;
			}
			case "issue":
			case "pr": {
				const repo2 =
					(r.repository as Record<string, unknown>)?.nameWithOwner || "?";
				const stateIcon =
					r.state === "open" ? "○" : r.state === "closed" ? "◉" : "●";
				const author = formatGhAuthor(r.author);
				lines.push(
					`${stateIcon} ${repo2}#${r.number}: ${r.title} (@${author})`,
					`  ${r.url}`,
				);
				break;
			}
			case "code": {
				const repo2 =
					(r.repository as Record<string, unknown>)?.nameWithOwner || "?";
				const url = r.url ? String(r.url) : "";
				lines.push(`📄 ${repo2}: ${r.path}${url ? `\n   ${url}` : ""}`);
				break;
			}
			case "commit": {
				const repo2 =
					(r.repository as Record<string, unknown>)?.nameWithOwner || "?";
				const sha = String(r.sha).slice(0, 7);
				const author = formatGhAuthor(r.author);
				const commit = r.commit as Record<string, unknown> | undefined;
				const message = (commit?.message as string)?.split("\n")[0] || sha;
				lines.push(
					`${sha} ${message} (@${author}) — ${repo2}${r.url ? `\n  ${r.url}` : ""}`,
				);
				break;
			}
			default:
				lines.push(JSON.stringify(r));
		}
	}
	return lines.join("\n");
}

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "gh_search",
		label: "GitHub Search",
		description:
			"Search GitHub for repositories, issues, pull requests, code, or users via the gh CLI search command.",
		promptSnippet: "Search GitHub",
		parameters: Type.Object(
			{
				type: Type.Optional(
					Type.Union(
						[
							Type.Literal("repos"),
							Type.Literal("issues"),
							Type.Literal("prs"),
							Type.Literal("code"),
							Type.Literal("commits"),
						],
						{
							description:
								"Search type: 'repos' (default), 'issues', 'prs', 'code', or 'commits'.",
						},
					),
				),
				query: Type.String({
					description: "Search query string (GitHub search syntax supported).",
				}),
				limit: Type.Optional(
					Type.Integer({
						description: "Max results (default: 10, max: 50).",
						minimum: 1,
						maximum: 50,
					}),
				),
				owner: Type.Optional(
					Type.String({
						description:
							"Limit search to a specific owner/org (e.g. 'owner:vercel').",
					}),
				),
				language: Type.Optional(
					Type.String({
						description:
							"Filter by language for repos/code (e.g. 'TypeScript').",
					}),
				),
				repo: Type.Optional(
					Type.String({
						description:
							"Filter by repo for issues/prs/code (e.g. 'owner/repo').",
					}),
				),
				sort: Type.Optional(
					Type.Union(
						[
							Type.Literal("stars"),
							Type.Literal("forks"),
							Type.Literal("updated"),
							Type.Literal("best-match"),
							Type.Literal("created"),
							Type.Literal("author-date"),
							Type.Literal("committer-date"),
						],
						{
							description:
								"Sort order: 'best-match' (default), or a type-specific sort — " +
								"'stars'/'forks'/'updated' for repos, 'created'/'updated' for " +
								"issues and PRs, 'author-date'/'committer-date' for commits. " +
								"A sort unsupported for the chosen type is rejected; code search " +
								"cannot be sorted.",
						},
					),
				),
				order: Type.Optional(
					Type.Union([Type.Literal("asc"), Type.Literal("desc")], {
						description: "Sort direction: 'desc' (default) or 'asc'.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRootBestEffort(cwd, _signal);
			await requireGh(root, _signal);

			const searchType = params.type || "repos";
			const limit = Math.min(params.limit ?? 10, 50);
			const sortByType: Record<string, string[]> = {
				repos: ["stars", "forks", "updated"],
				issues: ["created", "updated"],
				prs: ["created", "updated"],
				commits: ["author-date", "committer-date"],
				code: [],
			};
			if (
				params.sort &&
				params.sort !== "best-match" &&
				!sortByType[searchType]?.includes(params.sort)
			) {
				throw new Error(
					`Sort '${params.sort}' is not supported for ${searchType} search.`,
				);
			}
			if (searchType === "code" && (params.sort || params.order)) {
				throw new Error("Sort and order are not supported for code search.");
			}

			// Build query with optional qualifiers
			let query = validateSearchQuery(params.query);
			if (params.owner) {
				if (
					!/^[a-zA-Z0-9_.-]+$/.test(params.owner) ||
					params.owner.startsWith("-")
				) {
					throw new Error("Invalid owner format");
				}
				if (!query.includes("owner:")) query += ` owner:${params.owner}`;
			}
			if (params.language) {
				if (
					!/^[a-zA-Z0-9+#.-]+$/.test(params.language) ||
					params.language.startsWith("-")
				) {
					throw new Error("Invalid language format");
				}
				if (!query.includes("language:"))
					query += ` language:${params.language}`;
			}
			if (params.repo) {
				validateRepo(params.repo, "repo");
				if (!query.includes("repo:")) query += ` repo:${params.repo}`;
			}

			// gh uses the same plural subcommand names exposed by this tool.
			const ghType = searchType;
			const resultType =
				searchType === "repos"
					? "repo"
					: searchType === "issues"
						? "issue"
						: searchType === "prs"
							? "pr"
							: searchType === "commits"
								? "commit"
								: "code";

			const output = await run(
				"gh",
				buildSearchArgs(
					ghType,
					resultType,
					query,
					limit,
					params.sort,
					params.order,
				),
				root,
				undefined,
				_signal,
			);

			let parsed: unknown;
			try {
				parsed = JSON.parse(output);
			} catch {
				return {
					content: [
						{
							type: "text",
							text: output || `No results for "${params.query}".`,
						},
					],
					details: {
						type: searchType,
						query: params.query,
						count: 0,
					},
				};
			}

			if (!Array.isArray(parsed)) {
				return {
					content: [
						{
							type: "text",
							text: output || `No results for "${params.query}".`,
						},
					],
					details: {
						type: searchType,
						query: params.query,
						count: 0,
					},
				};
			}
			const results = parsed as Array<Record<string, unknown>>;
			if (results.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No ${searchType} results for "${params.query}".`,
						},
					],
					details: {
						type: searchType,
						query: params.query,
						count: 0,
					},
				};
			}

			// Format results in a human-friendly way
			const formatted = formatSearchResults(results, resultType);
			return {
				content: [{ type: "text", text: formatted }],
				details: {
					type: searchType,
					query: params.query,
					count: results.length,
				},
			};
		},
	});
}
