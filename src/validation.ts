/**
 * pi-git-tools — Input validation utilities.
 *
 * Provides validation functions to prevent command injection and ensure
 * parameter correctness for git and gh operations.
 */

// ---------------------------------------------------------------------------
// Validation Error
// ---------------------------------------------------------------------------

/** Validation error class for clear error handling. */
export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}

// ---------------------------------------------------------------------------
// Git Reference Validation
// ---------------------------------------------------------------------------

/** Characters that Git rejects in ref names and that cannot safely be passed on. */
function containsControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

const GIT_REF_SPECIAL_PATTERN = /[~^:?*[\]\\]/;
const GIT_REF_SHELL_PATTERN = /[;&|`$()<>]/;

/** Validate a git reference name (branch, tag, remote branch, etc.). */
export function validateGitRef(ref: string, field = "ref"): string {
	if (!ref || typeof ref !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (ref.length > 255) {
		throw new ValidationError(`${field}: exceeds 255 characters`);
	}
	if (
		containsControlCharacters(ref) ||
		/\s/.test(ref) ||
		GIT_REF_SHELL_PATTERN.test(ref)
	) {
		throw new ValidationError(`${field}: contains invalid characters`);
	}
	// A leading dash would be parsed as an option by many git subcommands.
	if (ref.startsWith("-")) {
		throw new ValidationError(`${field}: may not start with '-'`);
	}
	if (
		ref === "." ||
		ref === ".." ||
		ref.startsWith("/") ||
		ref.endsWith("/") ||
		ref.includes("//") ||
		ref.includes("..") ||
		/@\x7B/.test(ref) ||
		ref === "@"
	) {
		throw new ValidationError(`${field}: invalid format '${ref}'`);
	}
	if (GIT_REF_SPECIAL_PATTERN.test(ref)) {
		throw new ValidationError(`${field}: contains invalid characters`);
	}
	const components = ref.split("/");
	if (
		components.some(
			(component) =>
				component.startsWith(".") ||
				component.endsWith(".") ||
				component.endsWith(".lock"),
		)
	) {
		throw new ValidationError(`${field}: invalid format '${ref}'`);
	}
	return ref;
}

/** Validate a branch name (stricter than general ref). */
export function validateBranchName(name: string, field = "branch"): string {
	if (typeof name === "string" && name.startsWith("-")) {
		throw new ValidationError(`${field}: invalid branch name '${name}'`);
	}
	return validateGitRef(name, field);
}

/** Validate a tag name. */
export function validateTagName(name: string, field = "tag"): string {
	return validateGitRef(name, field);
}

/** Validate a remote name. */
export function validateRemoteName(name: string, field = "remote"): string {
	if (!name || typeof name !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (name.startsWith("-") || !/^[a-zA-Z0-9_.-]+$/.test(name)) {
		throw new ValidationError(`${field}: invalid remote name '${name}'`);
	}
	if (name.length > 50) {
		throw new ValidationError(`${field}: name too long`);
	}
	return name;
}

// ---------------------------------------------------------------------------
// Path Validation
// ---------------------------------------------------------------------------

/** Validate a repository-relative file path for git operations. */
export function validateGitPath(path: string, field = "path"): string {
	if (!path || typeof path !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (path.includes("\0")) {
		throw new ValidationError(`${field}: null byte not allowed`);
	}
	if (containsControlCharacters(path)) {
		throw new ValidationError(`${field}: control characters are not allowed`);
	}
	if (
		path.startsWith("-") ||
		path.startsWith("/") ||
		path.startsWith("~") ||
		/^[A-Za-z]:[\\/]/.test(path) ||
		path.startsWith("\\\\")
	) {
		throw new ValidationError(`${field}: path must be repository-relative`);
	}
	const components = path.replaceAll("\\", "/").split("/");
	if (components.includes("..")) {
		throw new ValidationError(`${field}: path traversal not allowed`);
	}
	if (path.length > 4096) {
		throw new ValidationError(`${field}: path too long`);
	}
	return path;
}

/** Validate a destination path, which may intentionally be absolute. */
export function validateDestinationPath(path: string, field = "path"): string {
	if (!path || typeof path !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (containsControlCharacters(path)) {
		throw new ValidationError(`${field}: control characters are not allowed`);
	}
	if (path.startsWith("-")) {
		throw new ValidationError(`${field}: may not start with '-'`);
	}
	if (path.length > 4096) {
		throw new ValidationError(`${field}: path too long`);
	}
	return path;
}

/** Validate a value that is passed as one non-option command argument. */
export function validateCommandValue(value: string, field = "value"): string {
	if (!value || typeof value !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (containsControlCharacters(value)) {
		throw new ValidationError(`${field}: control characters are not allowed`);
	}
	if (value.startsWith("-")) {
		throw new ValidationError(`${field}: may not start with '-'`);
	}
	if (value.length > 4096) {
		throw new ValidationError(`${field}: value too long`);
	}
	return value;
}

// ---------------------------------------------------------------------------
// Config Key Validation
// ---------------------------------------------------------------------------

/** Validate git config key (e.g., 'user.name', 'core.editor'). */
export function validateConfigKey(key: string, field = "config key"): string {
	if (!key || typeof key !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	// Git config keys: section[.subsection].variable
	if (
		key.startsWith("-") ||
		!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]+$/i.test(key)
	) {
		throw new ValidationError(
			`${field}: invalid format '${key}' (expected section[.subsection].key)`,
		);
	}
	return key;
}

// ---------------------------------------------------------------------------
// Commit-ish Validation
// ---------------------------------------------------------------------------

/** Validate a commit-ish (SHA, tag, branch, HEAD~n, etc.). */
export function validateCommitish(ref: string, field = "commit"): string {
	if (!ref || typeof ref !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	// Allow SHA (full or abbreviated), refs, HEAD~, ranges, etc.
	// Be permissive about Git revision syntax, but never accept an option.
	if (containsControlCharacters(ref)) {
		throw new ValidationError(`${field}: contains invalid characters`);
	}
	if (/[;&|`$()<>]/.test(ref)) {
		throw new ValidationError(`${field}: contains shell metacharacters`);
	}
	if (ref.startsWith("-")) {
		throw new ValidationError(`${field}: may not start with '-'`);
	}
	if (ref.length > 255) {
		throw new ValidationError(`${field}: too long`);
	}
	return ref;
}

// ---------------------------------------------------------------------------
// Repository/URL Validation
// ---------------------------------------------------------------------------

/**
 * Validate a GitHub head ref for PR creation: either a plain branch name or
 * the cross-repo form 'owner:branch' (fork PRs).
 */
export function validateGhHeadRef(ref: string, field = "head"): string {
	if (!ref || typeof ref !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	const colon = ref.indexOf(":");
	if (colon === -1) {
		return validateBranchName(ref, field);
	}
	const owner = ref.slice(0, colon);
	const branch = ref.slice(colon + 1);
	if (colon === 0 || ref.indexOf(":", colon + 1) !== -1) {
		throw new ValidationError(
			`${field}: invalid format '${ref}' (expected branch or owner:branch)`,
		);
	}
	if (owner.startsWith("-") || !/^[a-zA-Z0-9_.-]+$/.test(owner)) {
		throw new ValidationError(`${field}: invalid owner in '${ref}'`);
	}
	validateBranchName(branch, `${field} branch`);
	return ref;
}

/** Validate repository owner/repo format. */
export function validateRepo(repo: string, field = "repo"): string {
	if (!repo || typeof repo !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (
		repo.startsWith("-") ||
		repo.split("/").some((part) => part.startsWith("-")) ||
		!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)
	) {
		throw new ValidationError(
			`${field}: invalid format '${repo}' (expected owner/repo)`,
		);
	}
	return repo;
}

/** Validate a git remote URL (HTTPS, SSH, git, file, or local path). */
export function validateRemoteUrl(url: string, field = "url"): string {
	if (!url || typeof url !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (url.includes("\0")) {
		throw new ValidationError(`${field}: null byte not allowed`);
	}
	if (containsControlCharacters(url)) {
		throw new ValidationError(`${field}: control characters are not allowed`);
	}
	if (url.startsWith("-")) {
		throw new ValidationError(`${field}: may not start with '-'`);
	}
	if (/[;&|`$<>]/.test(url)) {
		throw new ValidationError(`${field}: contains invalid characters`);
	}
	// HTTPS, SSH (git@host:path), ssh://, git://, file://, or local filesystem path
	const isValid =
		/^https?:\/\//.test(url) ||
		/^git@[^:]+:.+$/.test(url) ||
		/^ssh:\/\//.test(url) ||
		/^git:\/\//.test(url) ||
		/^file:\/\//.test(url) ||
		// Absolute or relative local paths (clone/add remote from disk)
		/^\.\.?\//.test(url) ||
		/^\//.test(url) ||
		/^[A-Za-z]:[\\/]/.test(url);
	if (!isValid) {
		throw new ValidationError(
			`${field}: invalid format. Use https://, git@host:path, ssh://, git://, file://, or a local path`,
		);
	}
	return url;
}

// ---------------------------------------------------------------------------
// Search Query Validation
// ---------------------------------------------------------------------------

/**
 * Validate a search query for GitHub search.
 *
 * Only the shell metacharacters are blocked: commands run through execFile
 * (never a shell), so there is no injection risk from the rest — and GitHub's
 * own search syntax legitimately uses parens and angle brackets for grouping
 * (e.g. '(is:issue is:open)') and comparison qualifiers (e.g. 'stars:>100',
 * 'created:>2024-01-01'), which must pass through.
 */
export function validateSearchQuery(query: string, field = "query"): string {
	if (!query || typeof query !== "string") {
		throw new ValidationError(`${field}: must be a non-empty string`);
	}
	if (query.length > 1000) {
		throw new ValidationError(`${field}: too long (max 1000 chars)`);
	}
	// Block shell metacharacters; everything else is safe as a positional argv
	if (containsControlCharacters(query) || /[;&|`$]/.test(query)) {
		throw new ValidationError(`${field}: contains invalid characters`);
	}
	return query;
}

/**
 * Validate an exclude pattern for git clean.
 *
 * Same character policy as validateSearchQuery: only shell metacharacters
 * are blocked — execFile never invokes a shell, and file paths legitimately
 * contain parens and angle brackets (e.g. 'foo (backup)/', 'a < b.txt').
 */
export function validateExcludePattern(pattern: string): string {
	if (!pattern || typeof pattern !== "string") {
		throw new ValidationError("exclude pattern: must be a non-empty string");
	}
	if (
		containsControlCharacters(pattern) ||
		pattern.startsWith("-") ||
		/[;&|`$]/.test(pattern)
	) {
		throw new ValidationError(
			`exclude pattern: contains invalid characters '${pattern}'`,
		);
	}
	return pattern;
}
