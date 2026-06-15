import type { UIMessage } from "@ai-sdk/react";

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

export const CHAT_COMPLETION_SYSTEM_PROMPT = `You perform inline chat message completion. Given a conversation and the user's partial message, predict how they will finish their thought.

You receive:
- CONVERSATION: recent messages between the user and assistant
- PARTIAL: the user's current message (text before the cursor)

Your output is the most likely continuation of PARTIAL. The completed message must sound natural — as if the user wrote it themselves.

Hard rules:
1. NEVER repeat text already in PARTIAL.
2. Write in the user's voice and style, matching the conversation tone.
3. Complete the current thought or sentence. 1–2 sentences max.
4. Output empty string when no confident completion exists — never guess.
5. Output format: raw continuation text only. No markdown fences. No commentary. No "Here is".

Examples:

CONVERSATION:
User: can you help me write a function that
Assistant: Sure, what should the function do?

PARTIAL: sorts an array of
OUTPUT: objects by a given key

CONVERSATION:
User: what's the best way to handle errors in
Assistant: In what context?

PARTIAL: a react
OUTPUT: server component?

CONVERSATION:
User: explain how closures work in
PARTIAL: JavaScript
OUTPUT:  with examples`;

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

  return `${convBlock}PARTIAL:
<<<
${prefix}
>>>${suffixBlock}

Continue the user's message.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
