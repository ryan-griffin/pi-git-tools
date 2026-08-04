/**
 * pi-git-tools — Core utility functions.
 *
 * Provides shared helpers for executing git/gh commands, detecting repo roots,
 * and resolving working directories.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitErrorHint } from "./hints.js";

const execFileAsync = promisify(execFile);

/** Error raised when a child process exits unsuccessfully. */
export class CommandError extends Error {
	readonly exitCode?: number | string;
	readonly stdout: string;
	readonly stderr: string;
	/** Tool-schema suggestion for known git failures (git commands only). */
	readonly hint?: string;

	constructor(
		message: string,
		options: {
			exitCode?: number | string;
			stdout?: string;
			stderr?: string;
			hint?: string;
		} = {},
	) {
		super(message);
		this.name = "CommandError";
		this.exitCode = options.exitCode;
		this.stdout = options.stdout ?? "";
		this.stderr = options.stderr ?? "";
		this.hint = options.hint;
	}
}

/**
 * Error raised when a command is killed by the timeout (PI_GIT_TOOLS_TIMEOUT_MS
 * or the default) or by host cancellation.
 *
 * Distinct from CommandError so callers can propagate genuine execution
 * failures instead of masking them as missing binaries or other conditions.
 */
export class CommandTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CommandTimeoutError";
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Type for tool execution context. */
export interface ToolContext {
	cwd?: string;
}

/** Standard tool result structure. */
export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Command Execution
// ---------------------------------------------------------------------------

/**
 * Safe env defaults for all commands.
 * GIT_TERMINAL_PROMPT=0 prevents git from hanging on auth prompts in
 * headless environments — fail fast with a clear error instead.
 * GIT_EDITOR=true avoids unexpected editor waits.
 * These safety-critical values always take precedence over caller overrides.
 */
const SAFE_ENV: Record<string, string> = {
	GIT_TERMINAL_PROMPT: "0",
	GIT_EDITOR: "true",
	GH_PROMPT_DISABLED: "1",
	// Prefer non-interactive gh behavior in agent contexts
	GH_NO_UPDATE_NOTIFIER: "1",
	// Deterministic English git messages regardless of host locale, so the
	// hint patterns (src/hints.ts) and error parsing never depend on locale.
	LC_ALL: "C",
	// Never emit ANSI colors, regardless of the user's color.ui setting
	// (color.ui=always leaks escape sequences into tool output). The
	// GIT_CONFIG_COUNT pair is read as highest-precedence config, like -c.
	// Requires git >= 2.31; older git ignores the variables (the --no-color
	// flags on diff/log/show/reflog remain as a secondary guard). gh ignores
	// these variables entirely.
	GIT_CONFIG_COUNT: "1",
	GIT_CONFIG_KEY_0: "color.ui",
	GIT_CONFIG_VALUE_0: "never",
};

/**
 * Strip only the trailing line terminator that git/gh append to output.
 * Unlike trimEnd(), this preserves meaningful trailing whitespace: config
 * values, repo paths, and patch lines may legitimately end in spaces/tabs.
 * Exactly one terminator is removed, so content with genuine trailing blank
 * lines stays faithful. Handles Windows CRLF; a lone CR is left untouched.
 */
function stripTrailingTerminator(s: string): string {
	return s.replace(/\r?\n$/, "");
}

/** Execute a command, returning stdout (or stderr when stdout is empty). */
export async function run(
	bin: string,
	args: string[],
	cwd?: string,
	env?: Record<string, string>,
	signal?: AbortSignal,
): Promise<string> {
	const opts: Record<string, unknown> = {
		maxBuffer: 50 * 1024 * 1024,
		encoding: "utf8",
	};
	if (cwd) opts.cwd = cwd;
	// Safety-critical prompt/editor variables cannot be overridden by callers.
	opts.env = { ...process.env, ...env, ...SAFE_ENV };
	// Host cancellation + configurable timeout (default 10 minutes).
	const configuredTimeout = Number(process.env.PI_GIT_TOOLS_TIMEOUT_MS);
	const timeoutMs =
		Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0
			? configuredTimeout
			: 600_000;
	const timeout = AbortSignal.timeout(timeoutMs);
	opts.signal = signal ? AbortSignal.any([signal, timeout]) : timeout;

	try {
		const { stdout, stderr } = (await execFileAsync(bin, args, opts)) as {
			stdout: string;
			stderr: string;
		};
		const out = stripTrailingTerminator(stdout ?? "");
		const err = stripTrailingTerminator(stderr ?? "");
		// stdout is the machine-readable/primary result; stderr is a fallback for
		// commands such as clone, fetch, and push that report only progress there.
		return out || err;
	} catch (err: unknown) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new CommandTimeoutError(
				`Command '${bin} ${args.join(" ")}' timed out or was cancelled.`,
			);
		}
		// A 50 MB capture cap protects against runaway output; explain it clearly.
		if (
			err instanceof Error &&
			"code" in err &&
			(err as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
		) {
			throw new Error(
				`Command '${bin} ${args.join(" ")}' output exceeded the 50 MB capture limit. ` +
					"Narrow the request (e.g. --stat or --name-only, a smaller range, or a path filter).",
			);
		}
		if (
			err &&
			typeof err === "object" &&
			("stderr" in err || "stdout" in err)
		) {
			const e = err as {
				stderr?: string;
				stdout?: string;
				message?: string;
				code?: number | string;
			};
			const stderr = e.stderr || "";
			const stdout = e.stdout || "";
			const msg = stripTrailingTerminator(
				stderr || stdout || e.message || String(err),
			);
			// Known git failures get a tool-schema suggestion (git only; gh
			// errors pass through untouched). Match against BOTH streams: git
			// merge/cherry-pick write CONFLICT text to stdout, while other
			// failures (push rejected, refs) go to stderr. The hint survives
			// tail-first error truncation because it is appended last.
			const hint =
				bin === "git"
					? gitErrorHint(args, `${stderr}\n${stdout}`, e.code)
					: undefined;
			throw new CommandError(hint ? `${msg}\n\n[Hint: ${hint}]` : msg, {
				exitCode: e.code,
				stdout,
				stderr,
				hint: hint ?? undefined,
			});
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Repository Detection
// ---------------------------------------------------------------------------

/** Detect the repo root from a working directory. */
export async function findRepoRoot(
	cwd?: string,
	signal?: AbortSignal,
): Promise<string> {
	try {
		return await run(
			"git",
			["rev-parse", "--show-toplevel"],
			cwd,
			undefined,
			signal,
		);
	} catch (err) {
		// A timeout or cancellation is an execution failure, not a repo-detection
		// result — propagate it untouched instead of wrapping it.
		if (err instanceof CommandTimeoutError) throw err;
		if (err instanceof Error) {
			const msg = err.message.toLowerCase();
			if (msg.includes("not a git repository")) {
				throw new Error("Not inside a git repository.");
			}
			if (
				msg.includes("command not found") ||
				msg.includes("enoent") ||
				msg.includes("not found") ||
				msg.includes("spawn unknown")
			) {
				throw new Error("Git is not installed or not in PATH.");
			}
			// Re-throw unexpected errors with context
			throw new Error(`Failed to detect repo root: ${err.message}`);
		}
		throw new Error("Failed to detect repo root.");
	}
}

/** Resolve the effective working directory. */
export function resolveCwd(ctx?: { cwd?: string }): string | undefined {
	return ctx?.cwd || undefined;
}

// ---------------------------------------------------------------------------
// Temp files
// ---------------------------------------------------------------------------

/**
 * Write content to a temp file and return a cleanup function.
 *
 * Tools whose commands need stdin-style input (git apply, gh api --input)
 * can't use pipes — run() never feeds the child's stdin, so the process would
 * hang until timeout. A temp file sidesteps that entirely.
 */
export function tempInputFile(
	prefix: string,
	content: string,
): { path: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
	const path = join(dir, "input");
	writeFileSync(path, content, "utf8");
	return {
		path,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}
