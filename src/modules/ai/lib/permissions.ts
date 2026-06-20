import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  DEFAULT_PERMISSIONS,
  type ToolApprovalPolicy,
  type ToolPermissions,
} from "@/modules/settings/store";
import type { PermissionMode } from "../store/chatStore";

export type ResolvedPolicy = "auto-approve" | "deny" | "ask";

/**
 * Resolve the effective approval policy for a tool call.
 *
 * Priority:
 *  1. Session-level permissionMode override ("auto-approve" / "read-only")
 *  2. Persistent per-tool permissions from Settings → Permissions
 *  3. Shell allowlist patterns (bash_run / bash_background only)
 *  4. Fallback: "ask"
 */
export function resolveToolPolicy(
  toolName: string,
  permissionMode: PermissionMode,
  toolInput?: unknown,
): ResolvedPolicy {
  // Session-level overrides take absolute precedence.
  if (permissionMode === "auto-approve") return "auto-approve";
  if (permissionMode === "read-only") return "deny";

  // "default" — consult persistent per-tool permissions.
  const prefs = usePreferencesStore.getState();
  const perms: ToolPermissions =
    prefs.permissions?.toolPermissions ?? DEFAULT_PERMISSIONS.toolPermissions;

  const key = toolName as keyof ToolPermissions;
  const policy: ToolApprovalPolicy | undefined = perms[key];

  if (policy === "auto-approve") return "auto-approve";
  if (policy === "deny") return "deny";

  // When the per-tool policy is "ask" (or absent), check the shell allowlist
  // for bash_run / bash_background so common dev commands can be auto-approved.
  if (
    (toolName === "bash_run" || toolName === "bash_background") &&
    toolInput &&
    typeof toolInput === "object" &&
    "command" in toolInput
  ) {
    const cmd = String((toolInput as Record<string, unknown>).command);
    if (isShellAllowed(cmd)) return "auto-approve";
  }

  return "ask";
}

// ---- shell allowlist -------------------------------------------------------

function isShellAllowed(command: string): boolean {
  const prefs = usePreferencesStore.getState();
  const allowlist = prefs.permissions?.shellAllowlist ?? [];
  const trimmed = command.trim();
  for (const entry of allowlist) {
    if (!entry.enabled) continue;
    if (matchGlob(trimmed, entry.pattern)) return true;
  }
  return false;
}

function matchGlob(str: string, pattern: string): boolean {
  // Convert a user-facing glob pattern (where * matches any sequence) into an
  // anchored regex.  Escape every special regex character first, then swap
  // unescaped * for .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*");
  try {
    return new RegExp(`^${regexStr}$`).test(str);
  } catch {
    return false;
  }
}
