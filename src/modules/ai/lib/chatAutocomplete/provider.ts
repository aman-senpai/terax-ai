import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  LMSTUDIO_DEFAULT_BASE_URL,
  type AutocompleteProviderId,
} from "@/modules/ai/config";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  buildThinkingProviderOptions,
  DEFAULT_THINKING_LEVEL,
  type ThinkingLevel,
} from "@/modules/ai/lib/thinking";
import { generateText } from "ai";
import {
  buildChatUserPrompt,
  CHAT_COMPLETION_SYSTEM_PROMPT,
  type ChatCompletionRequest,
} from "./prompt";

export type ChatAutocompleteDeps = {
  provider: AutocompleteProviderId;
  modelId: string;
  apiKey: string | null;
  lmstudioBaseURL: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
  thinkingLevel?: ThinkingLevel;
};

const MAX_OUTPUT_TOKENS = 64;

export async function requestChatCompletion(
  req: ChatCompletionRequest,
  deps: ChatAutocompleteDeps,
  signal: AbortSignal,
): Promise<string> {
  const modelId =
    deps.modelId.trim() || DEFAULT_AUTOCOMPLETE_MODEL[deps.provider] || "";
  if (!modelId) {
    throw new Error(`No autocomplete model id set for ${deps.provider}.`);
  }

  const keys = { ...EMPTY_PROVIDER_KEYS, [deps.provider]: deps.apiKey };
  const model = await buildLanguageModel(deps.provider, keys, modelId, {
    lmstudioBaseURL: deps.lmstudioBaseURL || LMSTUDIO_DEFAULT_BASE_URL,
    mlxBaseURL: deps.mlxBaseURL,
    ollamaBaseURL: deps.ollamaBaseURL,
    openaiCompatibleBaseURL: deps.openaiCompatibleBaseURL,
  });

  const thinkingLevel =
    deps.provider === "deepseek"
      ? ("off" as const)
      : (deps.thinkingLevel ?? DEFAULT_THINKING_LEVEL);
  const providerOptions = buildThinkingProviderOptions(
    deps.provider,
    thinkingLevel,
    modelId,
  );

  const isReasoning = /\bgpt-oss\b/i.test(modelId);
  const isDeepSeek = deps.provider === "deepseek";
  const maxOutputTokens = isReasoning || isDeepSeek ? 1024 : MAX_OUTPUT_TOKENS;

  const { text } = await generateText({
    model,
    system: CHAT_COMPLETION_SYSTEM_PROMPT,
    prompt: buildChatUserPrompt(req),
    maxOutputTokens,
    maxRetries: 0,
    abortSignal: signal,
    temperature: 0.3,
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  });

  return cleanCompletion(text);
}

function cleanCompletion(raw: string): string {
  let t = raw;

  // Strip markdown fences if the model wrapped the output.
  const fence = t.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1];

  // Strip common preamble noise.
  t = t.replace(/^(Here is|Output:|Completion:|Sure[,!]?)\s*/i, "");

  // Strip surrounding quotes.
  t = t.replace(/^["']/, "").replace(/["']$/, "");

  // Don't start with a newline.
  t = t.replace(/^\n+/, "");

  // Trim trailing whitespace but preserve intentional line breaks.
  t = t.replace(/\s+$/, "");

  return t;
}
