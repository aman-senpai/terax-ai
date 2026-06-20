import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  PROMPT_META,
  applyOverrides,
  clearOverride,
  getDefaultPrompt,
  getPrompt,
  setOverride,
  type PromptCategory,
  type PromptKey,
  type PromptMeta,
} from "@/modules/ai/lib/prompts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setPromptOverrides } from "@/modules/settings/store";
import { SectionHeader } from "@/settings/components/SectionHeader";
import { ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Category sort order
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: Record<PromptCategory, number> = {
  System: 0,
  "Agent Persona": 1,
  "Commands & Messages": 2,
  Internal: 3,
};

const sortedMeta = [...PROMPT_META].sort((a, b) => {
  const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (catDiff !== 0) return catDiff;
  return a.label.localeCompare(b.label);
});

// ---------------------------------------------------------------------------
// Single prompt editor row
// ---------------------------------------------------------------------------

function PromptEditor({
  meta,
  currentValue,
  defaultValue,
  onChange,
}: {
  meta: PromptMeta;
  currentValue: string;
  defaultValue: string;
  onChange: (key: PromptKey, value: string | null) => void;
}) {
  const [draft, setDraft] = useState(currentValue);
  const [expanded, setExpanded] = useState(false);
  const hadFirstSync = useRef(false);
  const isOverridden = currentValue !== defaultValue;
  const isDirty = draft !== currentValue;

  useEffect(() => {
    if (!hadFirstSync.current) {
      hadFirstSync.current = true;
      setDraft(currentValue);
    }
  }, [currentValue]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed === defaultValue.trim() || trimmed === "") {
      onChange(meta.key, null);
    } else {
      onChange(meta.key, trimmed);
    }
  };

  const handleReset = () => {
    setDraft(defaultValue);
    onChange(meta.key, null);
  };

  const preview =
    currentValue.length > 120
      ? `${currentValue.slice(0, 120).replace(/\n/g, " ")}…`
      : currentValue.replace(/\n/g, " ");

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground">
              {meta.label}
            </span>
            {isOverridden && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                OVERRIDDEN
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {meta.description}
          </p>
          {!expanded && (
            <p className="mt-1.5 truncate font-mono text-[10px] leading-relaxed text-muted-foreground/70">
              {preview}
            </p>
          )}
        </div>
        <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground/50">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[200px] resize-y bg-card/60 font-mono text-[11px] leading-relaxed border border-border"
            placeholder={defaultValue.slice(0, 200)}
          />
          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {isOverridden && !isDirty && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={handleReset}
                  className="h-7 gap-1 text-[10px] text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon
                    icon={ArrowReloadHorizontalIcon}
                    size={11}
                    strokeWidth={1.75}
                  />
                  Reset to default
                </Button>
              )}
              {isDirty && (
                <span className="text-[10px] text-muted-foreground">
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {isDirty && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setDraft(currentValue)}
                  className="h-7 text-[10px] text-muted-foreground"
                >
                  Cancel
                </Button>
              )}
              <Button
                size="xs"
                onClick={handleSave}
                disabled={!isDirty}
                className="h-7 text-[10px]"
              >
                Save override
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function PromptsSection() {
  const promptOverrides = usePreferencesStore((s) => s.promptOverrides);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const syncedRef = useRef(false);

  // Hydrate the prompts module from stored overrides on mount
  useEffect(() => {
    if (!hydrated || syncedRef.current) return;
    syncedRef.current = true;
    if (Object.keys(promptOverrides).length > 0) {
      applyOverrides(promptOverrides);
    }
  }, [hydrated, promptOverrides]);

  const handleChange = useCallback(
    (key: PromptKey, value: string | null) => {
      // Persist to settings store
      const next = { ...promptOverrides };
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      void setPromptOverrides(next);

      // Apply immediately to the runtime prompts module
      if (value === null) {
        clearOverride(key);
      } else {
        setOverride(key, value);
      }
    },
    [promptOverrides],
  );

  // Group by category
  const groups = new Map<PromptCategory, PromptMeta[]>();
  for (const m of sortedMeta) {
    const list = groups.get(m.category) ?? [];
    list.push(m);
    groups.set(m.category, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Prompts"
        description="View and override every system prompt, agent persona, and message template used by the AI. Overrides are saved globally and applied immediately."
      />

      {Array.from(groups.entries()).map(([category, metas]) => (
        <div key={category} className="flex flex-col gap-2">
          <Label>{category}</Label>
          <div className="flex flex-col gap-2">
            {metas.map((meta) => (
              <PromptEditor
                key={meta.key}
                meta={meta}
                currentValue={getPrompt(meta.key)}
                defaultValue={getDefaultPrompt(meta.key)}
                onChange={handleChange}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-tight text-muted-foreground uppercase">
      {children}
    </span>
  );
}
