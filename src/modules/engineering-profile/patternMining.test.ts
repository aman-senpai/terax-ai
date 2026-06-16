import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateObjectMock, appendSignalMock, signals, getCachedConfigMock } =
  vi.hoisted(() => {
    const signals: unknown[] = [];
    return {
      generateObjectMock: vi.fn(),
      appendSignalMock: vi.fn(async (s: unknown) => {
        signals.push(s);
      }),
      signals,
      getCachedConfigMock: vi.fn<() => Record<string, unknown>>(() => ({
        provider: "openai",
        modelId: "gpt-5",
        minConfidence: 0.35,
        maxAgeMs: 100000,
        decayHalfLifeMs: 100000,
        promotionThreshold: 0.7,
        demotionThreshold: 0.25,
        maxPreferences: 240,
        splitMinPreferences: 5,
        splitMinAverageConfidence: 0.6,
        splitMinShare: 0.25,
      })),
    };
  });

vi.mock("ai", () => ({
  generateObject: generateObjectMock,
}));

vi.mock("./storage", async () => {
  const actual = await vi.importActual<typeof import("./storage")>("./storage");
  let nextId = 0;
  return {
    ...actual,
    storage: {
      ...actual.storage,
      appendSignal: appendSignalMock,
      loadSignals: vi.fn(async () => signals),
      getProfile: vi.fn(async () => null),
      saveProfile: vi.fn(async () => {}),
    },
    getCachedConfig: getCachedConfigMock,
    newSignalId: () => `sig-${++nextId}`,
  };
});

vi.mock("@/modules/ai/lib/agent", () => ({
  buildConfiguredLanguageModel: vi.fn(async () => ({})),
}));

vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: {
    getState: () => ({
      apiKeys: { openai: "sk-test" },
      selectedModelId: "openai:gpt-5",
    }),
  },
}));

import { minePatterns } from "./patternMining";
import type { Signal } from "./types";

function sig(over: Partial<Signal> = {}): Signal {
  return {
    id: over.id ?? `s${Math.random()}`,
    timestamp: over.timestamp ?? Date.now(),
    source: over.source ?? "explicit-feedback",
    scope: over.scope ?? "user",
    projectRoot: over.projectRoot ?? null,
    category: over.category ?? "general",
    preference: over.preference ?? "Use TypeScript",
    evidence: over.evidence ?? "",
    weight: over.weight ?? 1,
  };
}

describe("minePatterns — autonomous pattern discovery", () => {
  beforeEach(() => {
    signals.length = 0;
    generateObjectMock.mockReset();
    appendSignalMock.mockClear();
    getCachedConfigMock.mockReturnValue({
      provider: "openai",
      modelId: "gpt-5",
      minConfidence: 0.35,
      maxAgeMs: 100000,
      decayHalfLifeMs: 100000,
      promotionThreshold: 0.7,
      demotionThreshold: 0.25,
      maxPreferences: 240,
      splitMinPreferences: 5,
      splitMinAverageConfidence: 0.6,
      splitMinShare: 0.25,
    });
  });

  it("returns early with no project root", async () => {
    const result = await minePatterns({ projectRoot: null });
    expect(result.patterns).toHaveLength(0);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("returns early with too few signals", async () => {
    signals.push(sig({}));
    signals.push(sig({ id: "s2" }));
    const result = await minePatterns({ projectRoot: "/test" });
    expect(result.patterns).toHaveLength(0);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("runs the LLM miner when there are enough signals", async () => {
    for (let i = 0; i < 10; i++) {
      signals.push(sig({ id: `s${i}`, preference: `Pref ${i}` }));
    }
    generateObjectMock.mockResolvedValueOnce({
      object: {
        patterns: [
          {
            category: "workflow",
            preference: "Always run tests after editing",
            evidence: "inferred from 10 signals",
            weight: 0.4,
          },
        ],
      },
    });
    const result = await minePatterns({ projectRoot: "/test" });
    expect(result.patterns).toHaveLength(1);
    expect(appendSignalMock).toHaveBeenCalled();
  });

  it("skips duplicate patterns that already exist in the signal history", async () => {
    for (let i = 0; i < 10; i++) {
      signals.push(
        sig({ id: `s${i}`, category: "testing", preference: "Use Vitest" }),
      );
    }
    generateObjectMock.mockResolvedValueOnce({
      object: {
        patterns: [
          {
            category: "testing",
            preference: "Use Vitest",
            evidence: "inferred",
            weight: 0.4,
          },
        ],
      },
    });
    const result = await minePatterns({ projectRoot: "/test" });
    expect(result.patterns).toHaveLength(0);
    expect(result.discarded.length).toBeGreaterThan(0);
  });

  it("calls the LLM miner when enough signals exist, even with different providers", async () => {
    getCachedConfigMock.mockReturnValue({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      minConfidence: 0.35,
      maxAgeMs: 100000,
      decayHalfLifeMs: 100000,
      promotionThreshold: 0.7,
      demotionThreshold: 0.25,
      maxPreferences: 240,
      splitMinPreferences: 5,
      splitMinAverageConfidence: 0.6,
      splitMinShare: 0.25,
    });
    for (let i = 0; i < 10; i++) {
      signals.push(sig({ id: `s${i}`, preference: `Pref ${i}` }));
    }
    generateObjectMock.mockResolvedValueOnce({
      object: {
        patterns: [
          {
            category: "workflow",
            preference: "Always run tests",
            evidence: "inferred from signals",
            weight: 0.4,
          },
        ],
      },
    });
    const result = await minePatterns({ projectRoot: "/test" });
    expect(result.patterns).toHaveLength(1);
    expect(generateObjectMock).toHaveBeenCalled();
  });
});
