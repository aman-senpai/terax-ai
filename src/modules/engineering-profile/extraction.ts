import { z } from "zod";
import {
  buildConfiguredLanguageModel,
  type LocalProviderConfig,
} from "@/modules/ai/lib/agent";
import { DEFAULT_MODEL_ID, type ProviderId } from "@/modules/ai/config";
import type {
  ProviderKeys,
  CustomEndpointKeys,
} from "@/modules/ai/lib/keyring";
import {
  isDomain,
  type Domain,
  type ExtractionResult,
  type PreferenceCandidate,
  type RefinementConfig,
  type RefinementProvider,
  type Signal,
  type Preference,
} from "./types";

export type ExtractorDeps = {
  getKeys: () => ProviderKeys;
  getModelId?: () => string;
  getLocalConfig?: () => LocalProviderConfig | undefined;
  getCustomEndpointKeys?: () => CustomEndpointKeys;
  getConfig: () => RefinementConfig;
  getPriorPreferences?: () => ReadonlyArray<Preference>;
};

export type Extractor = (
  signals: ReadonlyArray<Signal>,
  deps: ExtractorDeps,
) => Promise<ExtractionResult>;

const candidateSchema = z.object({
  category: z.string(),
  preference: z.string().min(3).max(280),
  evidence: z.string().min(1),
  weight: z.number().min(0.1).max(2),
  mergedPriorIds: z.array(z.string()).optional(),
  mappedSignalIds: z.array(z.string()).optional(),
});

const extractionSchema = z.object({
  candidates: z.array(candidateSchema),
});

const EXTRACTION_SYSTEM = `You are the Engineering Profile Builder, a high-fidelity agent that analyzes observed user actions, chat history, and feedback to maintain a clean, structured, and non-redundant engineering profile.

You are given:
1. EXISTING ENGINEERING PREFERENCES: Previously learned rules, styles, or patterns. Each has an [ID].
2. NEW OBSERVED SIGNALS: Raw hints, user feedback, or tool call patterns. Each has an [ID].

Your goal is to output a set of consolidated preferences (candidates). For each candidate:
1. Category: a short lowercase category name (e.g., design, architecture, style, testing, workflow, frontend, backend).
2. Preference: a concise, high-impact declarative guideline (e.g. "Prefer Biome over Prettier for linting", "Use feature-based folder structures"). Formulate the guideline in general terms, avoiding project-specific file names unless they represent a global stack choice. Never use filler phrases like "User prefers" or "The model should".
3. Evidence: a one-line summary of the specific signals or feedback that supports this preference.
4. Weight: a score between 0.1 and 2.0 based on how strongly the signals indicate this preference (explicit feedback = 1.5-2.0, repeated actions = 0.8-1.4, weak hint = 0.1-0.7).
5. mergedPriorIds: A list of IDs of existing preferences that this candidate merges, consolidates, updates, or replaces. IMPORTANT: If this candidate is a modification or reinforcement of an existing preference, you must include its ID here so the system preserves its identity. If you are merging multiple existing preferences because they have the same intent, list all of their IDs.
6. mappedSignalIds: A list of IDs of new signals that support or belong to this preference.

Strict Rules:
- DO NOT duplicate intents: If multiple new signals or existing preferences represent the same core guideline, merge them into a *single* candidate, listing their respective IDs in 'mergedPriorIds' and 'mappedSignalIds'. The system will refine confidence on that one entry from the full aggregated evidence. Never output duplicate or near-duplicate candidates for the same rule.
- Choose the single best canonical phrasing (clean, professional, no typos) as the "preference" value for the merged candidate.
- Pick one stable category for the consolidated intent. Do not emit the same rule under different categories (e.g. general + writing + documentation + content) in this or prior outputs.
- IGNORE META / OPERATIONAL: Never output a candidate about calling profile tools (refine_profile, record_preference_signal, get_profile, explain_preference, etc.), the learning agent, autonomous refinement, profile.md updates, or any agent instructions / workflow for the AI itself. These are not user engineering preferences.
- Discard one-offs: Temporary bug fixes, specific task orders, or one-off edits are not stable preferences and must be ignored.
- When signals or priors are rephrasings or reinforcements of a long-standing rule (e.g. repeated "I prefer ... STAR method for resume bullets"), always map every relevant prior ID and signal ID under exactly one candidate so confidence is refined on the canonical entry rather than creating or keeping duplicate entries.`;

export const llmExtractor: Extractor = async (signals, deps) => {
  const config = deps.getConfig();
  if (signals.length === 0) {
    return { candidates: [], discarded: [], provider: config.provider };
  }
  const localConfig = deps.getLocalConfig?.();
  const modelId = deps.getModelId?.() ?? DEFAULT_MODEL_ID;
  const model = await buildConfiguredLanguageModel(
    modelId,
    deps.getKeys(),
    localConfig,
  );
  
  const priors = deps.getPriorPreferences?.() ?? [];
  const prompt = renderInputsForLLM(signals, priors);
  
  try {
    const { generateObject } = await import("ai");
    const { buildThinkingProviderOptions } = await import(
      "@/modules/ai/lib/thinking"
    );
    const thinkingOptions = buildThinkingProviderOptions(
      config.provider as ProviderId,
      config.thinkingLevel ?? "off",
      modelId,
    );
    const { object } = await generateObject({
      model,
      system: EXTRACTION_SYSTEM,
      prompt,
      schema: extractionSchema,
      ...(Object.keys(thinkingOptions).length > 0
        ? { providerOptions: thinkingOptions }
        : {}),
    });
    const candidates: PreferenceCandidate[] = [];
    const discarded: { text: string; reason: string }[] = [];
    for (const c of object.candidates) {
      const category: Domain = isDomain(c.category) ? c.category : "general";
      if (c.preference.trim().length < 3) {
        discarded.push({ text: c.preference, reason: "too-short" });
        continue;
      }
      candidates.push({
        category,
        preference: c.preference.trim(),
        evidence: c.evidence.trim(),
        weight: clampWeight(c.weight),
        mergedPriorIds: c.mergedPriorIds ?? [],
        mappedSignalIds: c.mappedSignalIds ?? [],
      });
    }
    return { candidates, discarded, provider: config.provider };
  } catch (err) {
    console.warn(
      "[engineering-profile] LLM extraction failed:",
      err,
    );
    throw err;
  }
};

function clampWeight(w: number): number {
  if (Number.isNaN(w)) return 1;
  if (w < 0.1) return 0.1;
  if (w > 2) return 2;
  return w;
}


function renderInputsForLLM(
  signals: ReadonlyArray<Signal>,
  priors: ReadonlyArray<Preference>,
): string {
  const lines: string[] = [];
  
  if (priors.length > 0) {
    lines.push("### EXISTING ENGINEERING PREFERENCES");
    lines.push("Below are the preferences currently recorded in the user's engineering profile. If any new signals reinforce or modify these, you must map them using their exact ID in 'mergedPriorIds'.");
    for (const p of priors) {
      lines.push(`- [ID: ${p.id}] [Category: ${p.category}] "${p.preference}" (Confidence: ${p.confidence.toFixed(2)})`);
    }
    lines.push("");
  }

  lines.push("### NEW OBSERVED SIGNALS");
  lines.push("Below are the raw observations, user feedback, and actions. You must identify if they represent stable preferences, and if they map to any existing preferences above. (Repeated identical signals are grouped for brevity but all their IDs are listed so you can map every one.)");
  // Group *exact* repeats by the signal's own preference text (no fuzzy, no similarity on priors, just collation of the provided data so the LLM receives everything without a 300-line wall of near-identical text).
  const groups = new Map<string, {ids: string[], sample: any}>();
  for (const s of signals) {
    const key = `${s.category}::${s.preference}`;
    if (!groups.has(key)) groups.set(key, {ids: [], sample: s});
    groups.get(key)!.ids.push(s.id);
  }
  for (const g of groups.values()) {
    const s = g.sample;
    const idList = g.ids.length <= 8 ? g.ids.join(", ") : g.ids.slice(0,5).join(", ") + ` ... (+${g.ids.length-5} more)`;
    lines.push(`- [IDs: ${idList}] [Category: ${s.category}] [Source e.g. ${s.source}] Preference hint: "${s.preference}" | Example evidence: "${s.evidence}"  (total ${g.ids.length} signals with this exact hint)`);
  }
  
  return lines.join("\n");
}

export function pickExtractor(_config: RefinementConfig): Extractor {
  return llmExtractor;
}

const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "anthropic",
  "google",
  "groq",
  "openrouter",
  "openai-compatible",
  "lmstudio",
  "mlx",
  "ollama",
]);

export function supportsProvider(p: RefinementProvider): boolean {
  return SUPPORTED_PROVIDERS.has(p);
}

export type { Signal };
