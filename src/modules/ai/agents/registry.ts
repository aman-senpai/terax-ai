import { getSubagentSystemPrompt } from "../lib/prompts";

/**
 * Subagent system prompt. The subagent is spawned inside a generateText
 * call with full read/write/run tools. The prompt is DESIGNED to force
 * tool use — the model must call tools, not just describe what it would do.
 *
 * Key behavioral constraints:
 * - First response MUST be a tool call, never text.
 * - Use write_file to create files, not output markdown in the response.
 * - After completing tool calls, return a one-line summary.
 *
 * The prompt content is configurable via .xterax/prompts/subagent-system.md
 */
export const SUBAGENT_SYSTEM_PROMPT = getSubagentSystemPrompt();
