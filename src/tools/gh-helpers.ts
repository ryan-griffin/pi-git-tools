/**
 * pi-git-tools — Shared GitHub CLI helpers.
 *
 * These are used by gh_* tool registrations.
 */
import { CommandTimeoutError, findRepoRoot, run } from "../utils.js";
import { validateRepo } from "../validation.js";

export async function requireGh(repoRoot?: string, signal?: AbortSignal) {
	try {
		await run("gh", ["--version"], undefined, undefined, signal);
	} catch (err) {
		// Preserve real execution failures (timeout, host cancellation) instead
		// of misreporting them as a missing binary.
		if (err instanceof CommandTimeoutError || signal?.aborted) throw err;
		throw new Error(
			"GitHub CLI (gh) is not installed or not in PATH. Install it from https://cli.github.com/",
		);
	}
	// Check auth status silently — only fail if there's a real problem.
	// No -h flag: checks the active host (works for GitHub Enterprise hosts too).
	try {
		await run("gh", ["auth", "status"], repoRoot, undefined, signal);
	} catch (err: unknown) {
		if (err instanceof CommandTimeoutError || signal?.aborted) throw err;
		if (err instanceof Error) {
			const message = err.message;
			// Credential problems are fatal — every subsequent gh call would
			// fail too — so fail fast with the real message instead of a
			// confusing 401 further downstream. Covers: not logged in, the
			// "auth login" hint, failed logins, and invalid/expired tokens.
			const authFailure =
				message.includes("not logged in") ||
				message.includes("auth login") ||
				/failed to log in/i.test(message) ||
				/token[^\n]*(?:invalid|expired)/i.test(message);
			if (authFailure) throw err;
			// Other errors (e.g. no network, rate limit) are non-fatal — gh may still work partially
			console.warn(`[pi-git-tools] gh auth check warning: ${message}`);
		}
	}
}

/**
 * Best-effort repo-root probe for gh tools. Running outside a git repository
 * (or without git installed) is fine — gh resolves the repo from cwd itself —
 * but a timeout or host cancellation is a real execution failure and must
 * propagate instead of being silently masked as "not in a repo".
 */
export async function findRepoRootBestEffort(
	cwd?: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	try {
		return await findRepoRoot(cwd, signal);
	} catch (err) {
		if (err instanceof CommandTimeoutError) throw err;
		return undefined;
	}
}

const GITHUB_REMOTE_HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * Extract `owner/repo` from a git remote URL iff it points at github.com.
 * Returns null for any other host (GitLab, GitHub Enterprise, lookalikes)
 * or malformed URLs, so callers skip the remote instead of acting on the
 * wrong repository.
 */
export function githubRepoFromRemote(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed) return null;
	// Reject control characters: the WHATWG URL parser silently strips ASCII
	// tab/LF/CR, so a hostname like "git\nhub.com" would parse as github.com.
	for (const character of trimmed) {
		const code = character.charCodeAt(0);
		if (code <= 31 || code === 127) return null;
	}

	// scp-like syntax: [user@]host:path (e.g. git@github.com:owner/repo.git)
	const scp = trimmed.match(/^(?:[^@]+@)?([^/:]+):(.+)$/);
	let parsed: URL;
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) && scp) {
		try {
			parsed = new URL(`ssh://${scp[1]}/${scp[2]}`);
		} catch {
			return null;
		}
	} else {
		try {
			parsed = new URL(trimmed);
		} catch {
			return null;
		}
	}

	const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
	if (!GITHUB_REMOTE_HOSTS.has(host)) return null;

	const [owner, repo, ...rest] = parsed.pathname
		.split("/")
		.filter((segment) => segment.length > 0);
	if (!owner || !repo || rest.length > 0) return null;

	// GitHub forbids repo names ending in ".git", so it can only be a suffix.
	const lowerRepo = repo.toLowerCase();
	if (lowerRepo === ".git") return null;
	if (lowerRepo.endsWith(".git")) {
		const stripped = repo.slice(0, -4);
		// "..git" would strip to ".", which validateRepo's charset accepts but
		// no real GitHub repository name can be (dot-only segments).
		if (/^\.+$/.test(stripped)) return null;
		return `${owner}/${stripped}`;
	}
	return `${owner}/${repo}`;
}

export async function resolveRepo(
	target?: string,
	repoRoot?: string,
	signal?: AbortSignal,
): Promise<string> {
	if (target) return validateRepo(target, "repo");
	try {
		const remotes = await run("git", ["remote"], repoRoot, undefined, signal);
		for (const remote of remotes
			.split("\n")
			.map((name) => name.trim())
			.filter(Boolean)) {
			const remoteUrl = await run(
				"git",
				["remote", "get-url", remote],
				repoRoot,
				undefined,
				signal,
			);
			const repo = githubRepoFromRemote(remoteUrl);
			if (!repo) continue;
			try {
				return validateRepo(repo, "repo");
			} catch (err) {
				// A github.com remote with a malformed repo (e.g. percent-encoded
				// path) is skipped so a later valid remote can still resolve.
				if (err instanceof Error && err.message.includes("invalid format")) {
					continue;
				}
				throw err;
			}
		}
		throw new Error("No GitHub remote found.");
	} catch (err) {
		// Preserve real execution failures (timeout, host cancellation); other
		// failures (git unavailable, not a repository) are reported generically
		// — malformed remotes were already skipped above.
		if (err instanceof CommandTimeoutError || signal?.aborted) throw err;
		throw new Error(
			"No repository specified and could not detect from git remote.",
		);
	}
}

/** Extract a display login from gh JSON author fields (object or string). */
export function formatGhAuthor(author: unknown): string {
	if (!author) return "?";
	if (typeof author === "string") return author;
	if (typeof author === "object") {
		const a = author as Record<string, unknown>;
		if (typeof a.login === "string" && a.login) return a.login;
		if (typeof a.name === "string" && a.name) return a.name;
		if (typeof a.id === "string" && a.id) return a.id;
	}
	return "?";
}
