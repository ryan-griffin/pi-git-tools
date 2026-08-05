/**
 * pi-git-tools — gh_repo tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { resolveCwd, run } from "../../utils.js";
import {
	findRepoRootBestEffort,
	requireGh,
	resolveRepo,
} from "../gh-helpers.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "gh_repo",
		label: "GitHub Repo",
		description:
			"View repository information, list branches, or open the repo in the browser via the gh CLI.",
		promptSnippet: "Get GitHub repo info",
		parameters: Type.Object(
			{
				action: Type.Optional(
					Type.Union(
						[
							Type.Literal("view"),
							Type.Literal("list-branches"),
							Type.Literal("list-languages"),
							Type.Literal("open"),
						],
						{
							description:
								"Action: 'view' (default), 'list-branches', 'list-languages', or 'open'.",
						},
					),
				),
				repo: Type.Optional(
					Type.String({
						description:
							"Repository in 'owner/repo' format. Defaults to the current git remote.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			// Keep the caller's cwd when it is outside a Git repository so gh does
			// not silently fall back to the host process directory.
			const root = (await findRepoRootBestEffort(cwd, _signal)) ?? cwd;
			await requireGh(root, _signal);
			const repo = await resolveRepo(params.repo, root, _signal);
			const action = params.action || "view";

			switch (action) {
				case "view": {
					const output = await run(
						"gh",
						[
							"repo",
							"view",
							repo,
							"--json",
							"name,owner,description,url,homepageUrl,defaultBranchRef,createdAt,pushedAt,updatedAt,stargazerCount,forkCount,licenseInfo,primaryLanguage,languages,repositoryTopics,watchers,issues",
						],
						root,
						undefined,
						_signal,
					);
					let text = output;
					try {
						const r = JSON.parse(output) as Record<string, unknown>;
						const owner =
							(r.owner as Record<string, unknown>)?.login ||
							(r.owner as Record<string, unknown>)?.name ||
							"?";
						const lang =
							(r.primaryLanguage as Record<string, unknown>)?.name ||
							(typeof r.primaryLanguage === "string"
								? r.primaryLanguage
								: null);
						const defaultBranch =
							(r.defaultBranchRef as Record<string, unknown>)?.name || "?";
						text = [
							`${owner}/${r.name}`,
							r.description ? String(r.description) : "(no description)",
							`URL: ${r.url}`,
							`Default branch: ${defaultBranch}`,
							lang ? `Language: ${lang}` : null,
							`★ ${r.stargazerCount ?? 0}  forks: ${r.forkCount ?? 0}`,
						]
							.filter((l) => l != null)
							.join("\n");
					} catch {
						// keep raw JSON
					}
					return {
						content: [{ type: "text", text }],
						details: { repo, action: "view" },
					};
				}
				case "list-branches": {
					// gh repo list-branches is not a valid command; use the API directly
					const output = await run(
						"gh",
						[
							"api",
							`repos/${repo}/branches`,
							"--paginate",
							"--jq",
							'.[] | .name + (if .protected then " (protected)" else "" end)',
						],
						root,
						undefined,
						_signal,
					);
					const formatted = output
						.split("\n")
						.filter(Boolean)
						.map((b) => `  ${b}`)
						.join("\n");
					return {
						content: [
							{
								type: "text",
								text: `Branches in ${repo}:\n\n${formatted || "  (no branches)"}`,
							},
						],
						details: { repo, action: "list-branches" },
					};
				}
				case "list-languages": {
					const output = await run(
						"gh",
						["repo", "view", repo, "--json", "languages"],
						root,
						undefined,
						_signal,
					);
					return {
						content: [{ type: "text", text: output }],
						details: { repo, action: "list-languages" },
					};
				}
				case "open": {
					await run(
						"gh",
						["repo", "view", repo, "--web"],
						root,
						undefined,
						_signal,
					);
					return {
						content: [
							{
								type: "text",
								text: `Opened ${repo} in browser.`,
							},
						],
						details: { repo, action: "open" },
					};
				}
				default:
					throw new Error(
						`Unknown action '${action}'. Supported: view, list-branches, list-languages, open.`,
					);
			}
		},
	});
}
