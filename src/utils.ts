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
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	formatSize,
	type ToolDefinition,
	truncateHead,
} from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

/** Error raised when a child process exits unsuccessfully. */
export class CommandError extends Error {
	readonly exitCode?: number | string;
	readonly stdout: string;
	readonly stderr: string;

	constructor(
		message: string,
		options: {
			exitCode?: number | string;
			stdout?: string;
			stderr?: string;
		} = {},
	) {
		super(message);
		this.name = "CommandError";
		this.exitCode = options.exitCode;
		this.stdout = options.stdout ?? "";
		this.stderr = options.stderr ?? "";
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

const OUTPUT_LIMIT_DESCRIPTION =
	`Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} ` +
	"(whichever is hit first). If truncated, the result includes an explicit notice.";
const TRUNCATION_NOTICE_RESERVE_BYTES = 256;

type TextResult = { content: unknown[] };

/** Bound one text value using the same UTF-8 and line-count semantics as pi. */
function boundText(text: string): string {
	const initial = truncateHead(text);
	if (!initial.truncated) return text;

	const truncation = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES - 1,
		maxBytes: DEFAULT_MAX_BYTES - TRUNCATION_NOTICE_RESERVE_BYTES,
	});
	const omittedLines = truncation.totalLines - truncation.outputLines;
	const omittedBytes = truncation.totalBytes - truncation.outputBytes;
	const notice =
		`[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
		`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
		`${omittedLines} lines (${formatSize(omittedBytes)}) omitted.]`;
	return truncation.content ? `${truncation.content}\n${notice}` : notice;
}

/**
 * Bound every text block in a pi tool result, preserving non-text blocks and
 * all result metadata. Multiple text blocks are represented as one bounded
 * text block when truncation is needed, matching the model-facing output.
 */
function boundTextResult<T extends TextResult>(result: T): T {
	const textBlocks = result.content.filter(
		(block): block is { type: "text"; text: string } =>
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "text" &&
			"text" in block &&
			typeof block.text === "string",
	);
	if (textBlocks.length === 0) return result;

	const output = textBlocks.map((block) => block.text).join("\n");
	const boundedText = boundText(output);
	if (boundedText === output) return result;

	let inserted = false;
	const content: T["content"] = [];
	for (const block of result.content) {
		if (
			typeof block !== "object" ||
			block === null ||
			!("type" in block) ||
			block.type !== "text"
		) {
			content.push(block);
		} else if (!inserted) {
			content.push({ type: "text", text: boundedText } as T["content"][number]);
			inserted = true;
		}
	}
	return { ...result, content };
}

/**
 * Re-throw a tool failure with only its model-facing error message bounded.
 * The original Error object is retained so command metadata (exit code,
 * stdout, stderr, and custom fields) remains available to the host.
 */
function rethrowBounded(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	const bounded = boundText(message);
	if (error instanceof Error) {
		if (bounded !== message) error.message = bounded;
		throw error;
	}
	if (typeof error === "string") throw bounded;
	throw new Error(bounded, { cause: error });
}

/**
 * Apply pi's output contract to every text result registered by this extension.
 * Commands are still captured in full by run() so parsers and details retain
 * their existing behavior; only the result sent back to the model is bounded.
 */
export function withOutputLimits(pi: ExtensionAPI): ExtensionAPI {
	const boundedPi = Object.create(pi) as ExtensionAPI;
	boundedPi.registerTool = ((tool: ToolDefinition) => {
		const wrappedTool: ToolDefinition = {
			...tool,
			description: `${tool.description} ${OUTPUT_LIMIT_DESCRIPTION}`,
			execute: async (toolCallId, params, signal, onUpdate, ctx) => {
				const boundedOnUpdate = onUpdate
					? (partialResult: Parameters<NonNullable<typeof onUpdate>>[0]) =>
							onUpdate(boundTextResult(partialResult))
					: undefined;
				try {
					const result = await tool.execute(
						toolCallId,
						params,
						signal,
						boundedOnUpdate,
						ctx,
					);
					return boundTextResult(result);
				} catch (error) {
					rethrowBounded(error);
				}
			},
		};
		pi.registerTool(wrappedTool);
	}) as ExtensionAPI["registerTool"];
	return boundedPi;
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
};

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
		const out = (stdout ?? "").trimEnd();
		const err = (stderr ?? "").trimEnd();
		// stdout is the machine-readable/primary result; stderr is a fallback for
		// commands such as clone, fetch, and push that report only progress there.
		return out || err;
	} catch (err: unknown) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new Error(
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
			const msg = (stderr || stdout || e.message || String(err)).trim();
			throw new CommandError(msg || String(err), {
				exitCode: e.code,
				stdout,
				stderr,
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
