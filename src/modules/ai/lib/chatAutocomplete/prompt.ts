import type { UIMessage } from "@ai-sdk/react";
import {
  getAutocompleteSystemPrompt,
  getAutocompleteUserPrompt,
} from "@/modules/ai/lib/prompts";

export type ChatCompletionRequest = {
  /** The user's current partial input (before the cursor). */
  prefix: string;
  /** The text after the cursor (rare in chat, but supported). */
  suffix: string;
  /** Recent conversation messages for context. */
  context: ConversationMessage[];
};

export type ConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const MAX_CONTEXT_CHARS = 2000;
const MAX_PREFIX_CHARS = 1500;
const MAX_SUFFIX_CHARS = 200;

export function buildContextFromMessages(
  messages: readonly UIMessage[],
): ConversationMessage[] {
  // Take the last few messages, preferring recent turns.
  // Cap total chars to keep the prompt small and fast.
  const context: ConversationMessage[] = [];
  let total = 0;

  // Walk backwards through messages to get most recent first,
  // then reverse at the end.
  const recent: ConversationMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && total < MAX_CONTEXT_CHARS; i--) {
    const msg = messages[i];
    const role = msg.role as "user" | "assistant" | "system";
    // Extract text content from the message parts
    const text = extractMessageText(msg);
    if (!text.trim()) continue;

    const trimmed = text.length > 500 ? text.slice(0, 500) + "…" : text;
    recent.push({ role, content: trimmed });
    total += trimmed.length;
  }

  // Reverse to chronological order
  for (let i = recent.length - 1; i >= 0; i--) {
    context.push(recent[i]);
  }

  return context;
}

function extractMessageText(msg: UIMessage): string {
  // UIMessage has `parts` array — extract text parts
  if (msg.parts && Array.isArray(msg.parts)) {
    const texts: string[] = [];
    for (const part of msg.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        texts.push(part.text);
      }
    }
    return texts.join(" ");
  }
  // Fallback for messages without parts
  if (typeof (msg as any).content === "string") {
    return (msg as any).content as string;
  }
  return "";
}

export const CHAT_COMPLETION_SYSTEM_PROMPT = getAutocompleteSystemPrompt();

export function buildChatUserPrompt(req: ChatCompletionRequest): string {
  const prefix =
    req.prefix.length > MAX_PREFIX_CHARS
      ? req.prefix.slice(-MAX_PREFIX_CHARS)
      : req.prefix;
  const suffix =
    req.suffix.length > MAX_SUFFIX_CHARS
      ? req.suffix.slice(0, MAX_SUFFIX_CHARS)
      : req.suffix;

  let convBlock = "";
  if (req.context.length > 0) {
    const lines = req.context.map((m) => `${capitalize(m.role)}: ${m.content}`);
    convBlock = `CONVERSATION:\n${lines.join("\n\n")}\n\n`;
  }

  const suffixBlock = suffix ? `\n\nAFTER CURSOR:\n<<<\n${suffix}\n>>>` : "";

  const template = getAutocompleteUserPrompt();
  return template
    .replace("{context}", convBlock)
    .replace("{prefix}", prefix)
    .replace("{suffix}", suffixBlock);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
