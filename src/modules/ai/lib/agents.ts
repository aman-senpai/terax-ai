import { LazyStore } from "@tauri-apps/plugin-store";
import { getAgentPrompt } from "./prompts";

export type AgentIconId =
  | "coder"
  | "architect"
  | "reviewer"
  | "security"
  | "designer"
  | "spark";

export type Agent = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  icon: AgentIconId;
  builtIn: boolean;
};

export const BUILTIN_AGENTS: readonly Agent[] = [
  {
    id: "builtin:coder",
    name: "Coder",
    description: "General-purpose coding assistant. Writes, edits, and runs.",
    icon: "coder",
    builtIn: true,
    instructions: getAgentPrompt("coder"),
  },
  {
    id: "builtin:architect",
    name: "Architect",
    description: "Design and tradeoffs. Plans before code.",
    icon: "architect",
    builtIn: true,
    instructions: getAgentPrompt("architect"),
  },
  {
    id: "builtin:reviewer",
    name: "Code Reviewer",
    description: "Reviews diffs for correctness, perf, security.",
    icon: "reviewer",
    builtIn: true,
    instructions: getAgentPrompt("reviewer"),
  },
  {
    id: "builtin:security",
    name: "Security",
    description: "Threat-models changes and flags vulns.",
    icon: "security",
    builtIn: true,
    instructions: getAgentPrompt("security"),
  },
  {
    id: "builtin:designer",
    name: "Designer",
    description: "UI/UX critique and refinement.",
    icon: "designer",
    builtIn: true,
    instructions: getAgentPrompt("designer"),
  },
] as const;

const STORE_PATH = "xterax-agents.json";
const KEY_CUSTOM = "customAgents";
const KEY_ACTIVE = "activeAgentId";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type LoadedAgents = {
  custom: Agent[];
  activeId: string;
};

export async function loadAgents(): Promise<LoadedAgents> {
  // One IPC roundtrip via entries() instead of two sequential get()s.
  const entries = await store.entries();
  let custom: Agent[] | undefined;
  let activeId: string | undefined;
  for (const [k, v] of entries) {
    if (k === KEY_CUSTOM) custom = v as Agent[];
    else if (k === KEY_ACTIVE) activeId = v as string;
  }
  return { custom: custom ?? [], activeId: activeId ?? BUILTIN_AGENTS[0].id };
}

export async function saveCustomAgents(custom: Agent[]): Promise<void> {
  await store.set(KEY_CUSTOM, custom);
  await store.save();
}

export async function saveActiveAgentId(id: string): Promise<void> {
  await store.set(KEY_ACTIVE, id);
  await store.save();
}

export function newAgentId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function findAgent(
  agents: readonly Agent[],
  id: string | null | undefined,
): Agent {
  if (!id) return BUILTIN_AGENTS[0];
  return agents.find((a) => a.id === id) ?? BUILTIN_AGENTS[0];
}
