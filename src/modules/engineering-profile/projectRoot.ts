import { native } from "@/modules/ai/lib/native";

/**
 * Project root resolution + anchoring for the engineering profile.
 *
 * Raw context dirs (terminal cwd, explorer) can be deep subdirectories or
 * switch between entirely different checkouts. For the profile we want:
 *  - .xterax/ at the *git root* of the project (not a random subdir).
 *  - Stable across cd inside one repo.
 *  - Switches automatically when the active terminal/context moves to a
 *    different top-level checkout (e.g. resume vs xterax-ai).
 *
 * `resolveProfileProjectRoot` uses `git rev-parse --show-toplevel` via the
 * existing git bridge so it follows the actual repo the shell is in.
 *
 * `anchorProjectRoot` is a lightweight in-run latch that also protects
 * against deep paths when a git root wasn't resolvable.
 */

let anchoredRoot: string | null = null;

export function anchorProjectRoot(root: string | null): string | null {
  if (!root) return anchoredRoot;

  const normNew = root.replace(/\/$/, "");
  if (!anchoredRoot) {
    anchoredRoot = root;
    return anchoredRoot;
  }

  const normAnchored = anchoredRoot.replace(/\/$/, "");

  // If the new root is not a subdirectory of (or equal to) the current anchored root,
  // it represents a different top-level project. Update the anchor so that
  // preferences are correctly scoped to the project the user is currently
  // working in (e.g. switching between xterax-ai and resume checkouts in
  // different terminals or sessions).
  // This still protects against cd'ing into subdirectories of the current project
  // (a subdir root will be under the anchored one, so we keep the higher anchor
  // and write .xterax/ at the stable project root, not the subdir).
  if (!normNew.startsWith(normAnchored + "/") && normNew !== normAnchored) {
    anchoredRoot = root;
  }

  return anchoredRoot;
}

export function getAnchoredProjectRoot(): string | null {
  return anchoredRoot;
}

export function resetAnchoredProjectRoot(): void {
  anchoredRoot = null;
}

/**
 * Resolve the effective project root to use for the engineering profile
 * (where .xterax/ lives, where signals/profiles are stored) given a live
 * context directory.
 *
 * Prefers the git toplevel of that dir. Falls back to the raw dir when
 * not inside a git repo (or resolution fails). This makes profile follow
 * the project the user is actually working in, while never putting
 * .xterax/ inside a subdirectory.
 */
export async function resolveProfileProjectRoot(
  dir: string | null,
): Promise<string | null> {
  if (!dir) return null;
  try {
    const info = await native.gitResolveRepo(dir);
    if (info?.repoRoot) return info.repoRoot;
  } catch {
    // Fall through to raw dir (non-git dir, permission, etc.)
  }
  return dir;
}
