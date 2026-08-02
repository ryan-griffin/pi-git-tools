/**
 * pi-git-tools — output truncation for tool results.
 *
 * Pi requires custom tools to truncate their output to 2000 lines / 50 KB
 * (whichever is hit first) so large results can't overwhelm the LLM context
 * (see docs/extensions.md "Output Truncation"). Every tool registered by this
 * extension goes through `withOutputTruncation`, which:
 *
 * - truncates oversized result text (head-first: diff headers, stats, and the
 *   newest commits appear at the top of git output, so the beginning matters),
 * - saves the FULL output to a temp file and tells the model where to find it,
 * - merges the `TruncationResult` + file path into `details`,
 * - caps thrown error messages at the same limit (tail-first, so the fatal
 *   line at the end of git/gh stderr survives),
 * - appends the truncation limits to the tool description so the model knows
 *   the policy up front.
 *
 * Small results pass through byte-identical — the wrapper is a no-op unless
 * a limit is actually hit.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
	truncateTail,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

/** Temp directories holding full outputs, removed at session shutdown. */
const OUTPUT_DIRS = new Set<string>();

/** Policy statement appended to every tool description. */
export const TRUNCATION_DESCRIPTION_SUFFIX = `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first); when truncated, the full output is saved to a temp file (path in details.fullOutputPath).`;

/** Footer appended to truncated results, in the format documented by pi. */
function truncationFooter(
	truncation: TruncationResult,
	fullOutputPath?: string,
): string {
	let footer = `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
	if (fullOutputPath) footer += ` Full output saved to: ${fullOutputPath}`;
	footer += "]";
	return footer;
}

/** Write full output to a fresh temp file; returns the file path. */
export function writeTempOutput(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-git-tools-out-"));
	const path = join(dir, "output.txt");
	// Track the dir BEFORE writing so a failed write cannot orphan it from
	// session-shutdown cleanup; 0600 because the content may be sensitive
	// (diffs, logs, API responses).
	OUTPUT_DIRS.add(dir);
	writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
	return path;
}

/**
 * Cap a thrown error's message at the output limits (tail-first so the fatal
 * line survives). The full stderr/stdout stay on CommandError objects.
 *
 * Only truncateTail's own `truncated` flag decides whether the message is
 * touched, so an exact-boundary message (e.g. 2000 lines ending with a
 * trailing newline) never gets a misleading footer claiming lines dropped.
 */
export function capErrorMessage(err: unknown): unknown {
	if (err instanceof Error && err.message.length > 0) {
		const truncation = truncateTail(err.message, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});
		if (truncation.truncated) {
			err.message = `${truncation.content}${truncationFooter(truncation)}`;
		}
	}
	return err;
}

/**
 * Wrap a ToolDefinition so its result text is truncated to pi's output
 * limits, with the full output written to a temp file for the model to read.
 */
export function withOutputTruncation<
	TParams extends TSchema,
	TDetails = unknown,
	TState = unknown,
>(
	def: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	const description = def.description.includes("whichever is hit first")
		? def.description
		: `${def.description} ${TRUNCATION_DESCRIPTION_SUFFIX}`.trimEnd();
	return {
		...def,
		description,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			try {
				const result = await def.execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
				return truncateResult(result);
			} catch (err: unknown) {
				throw capErrorMessage(err);
			}
		},
	};
}

/** Truncate an AgentToolResult's text content, preserving small results. */
function truncateResult<TDetails>(
	result: AgentToolResult<TDetails>,
): AgentToolResult<TDetails> {
	// Every tool in this extension returns a single text block; join any text
	// blocks (separated by newlines) so stats and the saved file cover the
	// whole output, and keep non-text blocks (none today) untouched.
	const textBlocks = result.content.filter(
		(block) => block.type === "text",
	) as Array<{ type: "text"; text: string }>;
	const fullText = textBlocks.map((block) => block.text).join("\n");

	const truncation = truncateHead(fullText, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return result;

	const fullOutputPath = writeTempOutput(fullText);
	const nonText = result.content.filter((block) => block.type !== "text");
	const baseDetails =
		result.details === undefined || result.details === null
			? {}
			: (result.details as Record<string, unknown>);
	return {
		...result,
		content: [
			...nonText,
			{
				type: "text",
				text: `${truncation.content}${truncationFooter(truncation, fullOutputPath)}`,
			},
		],
		details: {
			...baseDetails,
			truncation,
			fullOutputPath,
		} as TDetails,
	};
}

/**
 * Register a tool with the output-truncation wrapper applied.
 * All tool modules use this instead of calling `pi.registerTool` directly.
 */
export function registerTool<
	TParams extends TSchema,
	TDetails = unknown,
	TState = unknown,
>(pi: ExtensionAPI, def: ToolDefinition<TParams, TDetails, TState>): void {
	pi.registerTool(withOutputTruncation(def));
}

/** Remove temp output files at session shutdown. Wire once from index.ts. */
export function registerTruncationCleanup(pi: ExtensionAPI): void {
	pi.on("session_shutdown", () => {
		for (const dir of [...OUTPUT_DIRS]) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// Best-effort: leftover temp files are harmless.
			}
		}
		OUTPUT_DIRS.clear();
	});
}
