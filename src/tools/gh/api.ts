/**
 * pi-git-tools — gh_api tool registration.
 *
 * Generic GitHub REST API access via `gh api` — the escape hatch for anything
 * the dedicated gh_* tools don't cover (deployments, releases, gists,
 * workflow runs, orgs, etc.). JSON bodies are passed via a temp file because
 * run() never feeds the child's stdin (gh api --input - would hang).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { resolveCwd, run, tempInputFile } from "../../utils.js";
import { findRepoRootBestEffort } from "../gh-helpers.js";

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "gh_api",
		label: "GitHub API",
		description:
			"Call any GitHub REST API endpoint via `gh api` (e.g. /repos/{owner}/{repo}/releases, /user). Use 'data' for a JSON body, 'params' for query parameters.",
		promptSnippet: "Call the GitHub REST API",
		parameters: Type.Object(
			{
				method: Type.Optional(
					Type.String({
						description:
							"HTTP method (default: GET). One of GET, POST, PATCH, PUT, DELETE.",
					}),
				),
				path: Type.String({
					description:
						"API endpoint path, starting with '/'. Use {owner}/{repo} placeholders for the current repository (e.g. '/repos/{owner}/{repo}/issues/1/comments').",
				}),
				data: Type.Optional(
					Type.String({
						description:
							'JSON request body for POST/PATCH/PUT (e.g. \'{"title":"Fix bug"}\'). Must be valid JSON when provided.',
					}),
				),
				params: Type.Optional(
					Type.Record(Type.String(), Type.String(), {
						description:
							"Query/form parameters as key-value pairs (e.g. { per_page: '100' }), passed as -f key=value.",
					}),
				),
				field: Type.Optional(
					Type.String({
						description:
							"Optional jq expression to extract from the response (e.g. '.[0].sha' or '.id').",
					}),
				),
				paginate: Type.Optional(
					Type.Boolean({
						description:
							"Automatically fetch all pages of results (--paginate).",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRootBestEffort(cwd, _signal);

			const method = (params.method || "GET").toUpperCase();
			if (!METHODS.includes(method)) {
				throw new Error(
					`Invalid method '${method}'. Use one of: ${METHODS.join(", ")}.`,
				);
			}
			const path = params.path;
			if (!path || typeof path !== "string") {
				throw new Error(
					"'path' is required (e.g. '/repos/{owner}/{repo}/issues').",
				);
			}
			if (!path.startsWith("/")) {
				throw new Error(
					"'path' must start with '/' (e.g. '/repos/{owner}/{repo}').",
				);
			}
			for (const character of path) {
				const code = character.charCodeAt(0);
				if (code <= 31 || code === 127 || code === 32) {
					throw new Error(
						"'path' contains invalid characters (control characters or whitespace).",
					);
				}
			}
			if (params.data !== undefined) {
				// GET/DELETE take no request body.
				if (method === "GET" || method === "DELETE") {
					throw new Error(`'data' is not valid for ${method} requests.`);
				}
				try {
					JSON.parse(params.data);
				} catch {
					throw new Error("'data' must be valid JSON.");
				}
			}

			const args = ["api", path, "--method", method];
			if (params.paginate) args.push("--paginate");
			if (params.field) args.push("-q", params.field);
			if (params.params) {
				for (const [key, value] of Object.entries(params.params)) {
					args.push("-f", `${key}=${value}`);
				}
			}

			let output: string;
			if (params.data !== undefined) {
				const { path: bodyPath, cleanup } = tempInputFile(
					"pi-gh-api",
					params.data,
				);
				try {
					args.push("--input", bodyPath);
					output = await run("gh", args, root, undefined, _signal);
				} finally {
					cleanup();
				}
			} else {
				output = await run("gh", args, root, undefined, _signal);
			}

			return {
				content: [{ type: "text", text: output }],
				details: {
					method,
					path,
					field: params.field || null,
					paginated: !!params.paginate,
					outputLength: output.length,
				},
			};
		},
	});
}
