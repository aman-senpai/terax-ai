import { useEffect, useState, type ReactElement } from "react";
import type { AgentState } from "./learningAgent";

const STATUS_LABEL: Record<AgentState["status"], string> = {
  idle: "idle",
  observing: "observing",
  refining: "refining",
  writing: "writing",
  error: "error",
};

const STATUS_COLOR: Record<AgentState["status"], string> = {
  idle: "text-muted-foreground",
  observing: "text-blue-500",
  refining: "text-amber-500",
  writing: "text-amber-500",
  error: "text-red-500",
};

const NOOP_STATE: AgentState = {
  status: "idle",
  lastRefineAt: 0,
  signalsSinceLastRefine: 0,
  totalRefinements: 0,
  lastError: null,
  lastSummary: "idle",
  startedAt: 0,
};

function displayLabel(state: AgentState): string {
  if (state.status === "error") return "error";
  if (state.status !== "idle") return STATUS_LABEL[state.status];
  if (state.signalsSinceLastRefine > 0) return "pending";
  if (state.totalRefinements > 0) return "ready";
  return "idle";
}

function displayColor(state: AgentState): string {
  if (state.status === "error" || state.lastError) {
    return STATUS_COLOR.error;
  }
  if (state.status !== "idle") return STATUS_COLOR[state.status];
  if (state.signalsSinceLastRefine > 0) return "text-blue-500";
  if (state.totalRefinements > 0) return "text-emerald-500/70"; // distinct "has done work" color
  return STATUS_COLOR.idle;
}

/**
 * Tiny status pill for the bottom status bar. Shows what the autonomous
 * continuous-learning agent is doing in the background. The agent module
 * is loaded lazily so the StatusBar does not pull the AI SDK into the
 * startup graph.
 *
 * Uses fresh immutable snapshots from the agent on every emit so React
 * updates are reliable (prevents "stale" / no-update appearance from
 * in-place mutation of a shared state object).
 */
export function LearningAgentPill(): ReactElement {
  const [state, setState] = useState<AgentState>(NOOP_STATE);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void import("./learningAgent").then((m) => {
      if (cancelled) return;
      // Always start with a fresh snapshot
      setState(m.getAgentState());
      // subscribe will also immediately deliver the current snapshot (as a fresh object)
      unsub = m.subscribeAgent(setState);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);
  const label = displayLabel(state);
  const color = displayColor(state);
  const tooltip = `${state.lastSummary} • ${state.totalRefinements} refinements since startup`;
  const isActive =
    state.status !== "idle" || state.signalsSinceLastRefine > 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] tabular-nums ${color}`}
      title={tooltip}
      data-state={state.status}
    >
      <span
        className={`inline-block size-1.5 rounded-full ${
          isActive ? "bg-current animate-pulse" : "bg-muted-foreground/40"
        }`}
      />
      <span>learn:{label}</span>
      {state.signalsSinceLastRefine > 0 ? (
        <span className="text-muted-foreground">
          +{state.signalsSinceLastRefine}
        </span>
      ) : null}
    </span>
  );
}