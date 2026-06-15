import { usePreferencesStore } from "@/modules/settings/preferences";
import { useCallback, useEffect, useRef } from "react";
import { getChat, useChatStore } from "../../store/chatStore";
import {
  editorToText,
  getCaretOffset,
  setCaretOffset,
} from "../contenteditable";
import { getKey } from "../keyring";
import { onKeysChanged } from "@/modules/settings/store";
import type { ChatAutocompleteDeps } from "./provider";
import { requestChatCompletion } from "./provider";
import { buildContextFromMessages, type ChatCompletionRequest } from "./prompt";

const DEBOUNCE_MS = 350;
const MIN_PREFIX_NON_WS = 2;
const CACHE_SIZE = 16;

class CompletionCache {
  private map = new Map<string, string>();
  constructor(private cap: number) {}
  get(k: string): string | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: string) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.cap) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }
}

function buildCacheKey(prefix: string, contextHash: string): string {
  const p = prefix.length > 256 ? prefix.slice(-256) : prefix;
  return `${contextHash}\x00${p}`;
}

function contextHash(context: ChatCompletionRequest["context"]): string {
  if (context.length === 0) return "";
  const last = context[context.length - 1];
  return `${last.role}:${last.content.slice(0, 80)}`;
}

function resolveModelId(
  provider: ChatAutocompleteDeps["provider"],
  s: ReturnType<typeof usePreferencesStore.getState>,
): string {
  switch (provider) {
    case "lmstudio":
      return s.lmstudioModelId;
    case "mlx":
      return s.mlxModelId;
    case "ollama":
      return s.ollamaModelId;
    case "openai-compatible":
      return s.openaiCompatibleModelId;
    case "openrouter":
      return s.openrouterModelId;
    default:
      return s.autocompleteModelId;
  }
}

/** Create a ghost <span> placed inline at the caret position. */
function insertGhostSpan(root: HTMLElement, text: string): void {
  // Remove any existing ghost first.
  root.querySelectorAll("[data-ghost]").forEach((el) => el.remove());

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return;

  const span = document.createElement("span");
  span.dataset.ghost = "";
  span.textContent = text;
  span.style.opacity = "0.4";
  span.style.fontStyle = "italic";
  span.style.pointerEvents = "none";
  span.style.userSelect = "none";
  span.setAttribute("aria-hidden", "true");

  // Set contentEditable to false so the browser treats it as an atomic unit.
  span.contentEditable = "false";

  range.insertNode(span);
  // Move caret BEFORE the ghost span so typing naturally overwrites it.
  range.setStartBefore(span);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function removeGhostSpan(root: HTMLElement): void {
  root.querySelectorAll("[data-ghost]").forEach((el) => el.remove());
}

function replaceGhostWithText(root: HTMLElement, ghostText: string): number {
  const ghost = root.querySelector("[data-ghost]");
  let caretOffset = -1;

  if (ghost) {
    const parent = ghost.parentNode;
    if (parent) {
      // Compute the text offset of the ghost before removing it.
      caretOffset = getCaretOffset(root);

      const textNode = document.createTextNode(ghostText);
      parent.replaceChild(textNode, ghost);

      // Set caret immediately after the inserted text — synchronous to avoid
      // a visible cursor flash at the wrong position.
      const finalCaret = caretOffset + ghostText.length;
      setCaretOffset(root, finalCaret);
      return finalCaret;
    }
  }
  return caretOffset;
}

export function useChatAutocomplete(
  editorRef: React.RefObject<HTMLDivElement | null>,
  isPickerOpen: boolean,
  onAccept: (newValue: string) => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new CompletionCache(CACHE_SIZE));
  const apiKeyRef = useRef<string | null>(null);
  const pickerOpenRef = useRef(isPickerOpen);
  pickerOpenRef.current = isPickerOpen;
  const isBusyRef = useRef(false);
  const agentStatus = useChatStore((s) => s.agentMeta.status);
  isBusyRef.current = agentStatus === "thinking" || agentStatus === "streaming";

  // Whether a ghost is currently showing in the DOM.
  const ghostActiveRef = useRef(false);

  // Suppress the input event that fires when we insert the ghost span via
  // Range API (Chrome fires a synchronous 'input' event on insertNode).
  const suppressInputRef = useRef(0);

  // Fetch API key on mount.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const p = usePreferencesStore.getState().autocompleteProvider;
      if (p === "lmstudio" || p === "mlx" || p === "ollama") {
        apiKeyRef.current = null;
        return;
      }
      const k = await getKey(p);
      if (alive) apiKeyRef.current = k;
    };
    void refresh();
    const unsub = usePreferencesStore.subscribe((state, prev) => {
      if (state.autocompleteProvider !== prev.autocompleteProvider) {
        void refresh();
      }
    });
    let unlistenKeys: (() => void) | undefined;
    void onKeysChanged(() => void refresh()).then((un) => {
      unlistenKeys = un;
    });
    return () => {
      alive = false;
      unsub();
      unlistenKeys?.();
    };
  }, []);

  // Cancel everything on unmount.
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  async function fireCompletion(text: string) {
    console.log(
      "[chat-autocomplete] fireCompletion called with text:",
      JSON.stringify(text),
    );
    if (!text) return;

    const s = usePreferencesStore.getState();
    const currentProvider = s.autocompleteProvider;

    console.log(
      "[chat-autocomplete] checks - enabled:",
      s.autocompleteEnabled,
      "pickerOpen:",
      pickerOpenRef.current,
      "isBusy:",
      isBusyRef.current,
    );

    if (!s.autocompleteEnabled) return;
    if (pickerOpenRef.current) return;
    if (isBusyRef.current) return;

    const nonWs = text.replace(/\s/g, "").length;
    console.log(
      "[chat-autocomplete] nonWs length:",
      nonWs,
      "MIN:",
      MIN_PREFIX_NON_WS,
    );
    if (nonWs < MIN_PREFIX_NON_WS) return;

    const modelId = resolveModelId(currentProvider, s);
    const apiKey =
      currentProvider === "lmstudio" ||
      currentProvider === "mlx" ||
      currentProvider === "ollama"
        ? null
        : apiKeyRef.current;

    console.log(
      "[chat-autocomplete] provider:",
      currentProvider,
      "modelId:",
      modelId,
      "apiKey present:",
      !!apiKey,
    );

    if (
      currentProvider !== "lmstudio" &&
      currentProvider !== "mlx" &&
      currentProvider !== "ollama" &&
      !apiKey
    ) {
      console.log("[chat-autocomplete] missing API key, returning early");
      return;
    }

    const deps: ChatAutocompleteDeps = {
      provider: currentProvider,
      modelId,
      apiKey,
      lmstudioBaseURL: s.lmstudioBaseURL,
      mlxBaseURL: s.mlxBaseURL,
      ollamaBaseURL: s.ollamaBaseURL,
      openaiCompatibleBaseURL: s.openaiCompatibleBaseURL,
      thinkingLevel: s.autocompleteThinkingLevel,
    };

    console.log("[chat-autocomplete] final deps:", deps);

    try {
      const chat = getChat();
      const messages = chat?.messages ?? [];
      const context = buildContextFromMessages(messages);
      console.log(
        "[chat-autocomplete] chat exists:",
        !!chat,
        "messages length:",
        messages.length,
        "context:",
        context,
      );

      const cacheKey = buildCacheKey(text, contextHash(context));
      const cached = cacheRef.current.get(cacheKey);
      console.log(
        "[chat-autocomplete] cache lookup:",
        cached !== undefined ? `hit: ${JSON.stringify(cached)}` : "miss",
      );
      if (cached !== undefined) {
        if (cached) {
          const el = editorRef.current;
          if (el) {
            suppressInputRef.current += 1;
            insertGhostSpan(el, cached);
            ghostActiveRef.current = true;
          }
        }
        return;
      }

      if (controllerRef.current) {
        console.log("[chat-autocomplete] aborting previous request");
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      const signal = controller.signal;

      const req: ChatCompletionRequest = { prefix: text, suffix: "", context };
      console.log(
        "[chat-autocomplete] calling requestChatCompletion with req:",
        req,
      );
      const result = await requestChatCompletion(req, deps, signal);
      console.log(
        "[chat-autocomplete] result received:",
        JSON.stringify(result),
      );
      if (signal.aborted) {
        console.log("[chat-autocomplete] request aborted post-completion");
        return;
      }

      cacheRef.current.set(cacheKey, result);
      if (result) {
        const el = editorRef.current;
        if (el) {
          console.log(
            "[chat-autocomplete] inserting ghost span:",
            JSON.stringify(result),
          );
          suppressInputRef.current += 1;
          insertGhostSpan(el, result);
          ghostActiveRef.current = true;
        } else {
          console.log("[chat-autocomplete] editorRef.current is null!");
        }
      } else {
        console.log("[chat-autocomplete] result is empty/falsy");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.log("[chat-autocomplete] request aborted (DOMException)");
        return;
      }
      console.warn(
        "[chat-autocomplete] request failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      if (controllerRef.current && controllerRef.current.signal.aborted) {
        controllerRef.current = null;
      }
    }
  }

  // Called directly from onInput.
  const trigger = useCallback((text: string, el: HTMLElement | null) => {
    // Suppress input events caused by ghost span insertion (Chromium fires a
    // synchronous 'input' event when range.insertNode() modifies the DOM).
    if (suppressInputRef.current > 0) {
      suppressInputRef.current -= 1;
      return;
    }

    // Always clear any existing ghost span from the DOM.
    if (ghostActiveRef.current) {
      if (el) removeGhostSpan(el);
      ghostActiveRef.current = false;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void fireCompletion(text);
    }, DEBOUNCE_MS);
  }, []);

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    const el = editorRef.current;
    if (el) removeGhostSpan(el);
    ghostActiveRef.current = false;
  }, [editorRef]);

  const accept = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    const ghostEl = el.querySelector("[data-ghost]");
    if (!ghostEl) return;

    const ghostText = ghostEl.textContent ?? "";
    if (!ghostText) return;

    el.focus();

    // Build the new value including the ghost text.
    const caret = getCaretOffset(el);
    const fullText = editorToText(el);
    const newText =
      fullText.slice(0, caret) + ghostText + fullText.slice(caret);

    replaceGhostWithText(el, ghostText);
    ghostActiveRef.current = false;

    // Sync React state.
    onAccept(newText);
  }, [editorRef, onAccept]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      const el = editorRef.current;
      const hasGhost = el?.querySelector("[data-ghost]");
      if (!hasGhost) return false;

      if (e.key === "Tab") {
        e.preventDefault();
        accept();
        return true;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        cancelPending();
        return true;
      }

      if (
        e.key.length === 1 ||
        e.key === "Backspace" ||
        e.key === "Delete" ||
        e.key === "Enter"
      ) {
        cancelPending();
        return false;
      }

      return false;
    },
    [editorRef, accept, cancelPending],
  );

  return {
    handleKeyDown,
    trigger,
    cancelPending,
  } as const;
}
