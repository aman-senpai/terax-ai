import {
  aggregateScore,
  applyKlAnchor,
  clamp01,
  distinctSourceCount,
  normalizeConfidence,
  normalizeText,
  // preferenceKey is used inside the exported buildFallbackCandidates helper (tested directly).
  preferenceKey,
} from "./confidence";
import {
  type Extractor,
  type ExtractorDeps,
  pickExtractor,
} from "./extraction";
import { makeBlankProfile, newPreferenceId, storage } from "./storage";
import {
  DEFAULT_REFINEMENT_CONFIG,
  type Domain,
  type DomainProfile,
  normalizeDomain,
  type Preference,
  type PreferenceCandidate,
  type Profile,
  type ProfileSnapshot,
  type RefinementConfig,
  type Scope,
  type Signal,
  type SignalSource,
  type SnapshotChange,
} from "./types";

export type RefineOptions = {
  scope: Scope;
  projectRoot: string | null;
  now?: number;
  reason?: ProfileSnapshot["reason"];
  note?: string | null;
};

export type RefineResult = {
  profile: Profile;
  snapshot: ProfileSnapshot;
  removed: Preference[];
  added: Preference[];
  modified: Preference[];
  dropped: Preference[];
};

/**
 * Core refinement pass:
 *  1. Load all signals for the scope.
 *  2. Run LLM extraction to produce candidates.
 *  3. For each candidate, find or create a preference and re-score.
 *  4. Decay / demote / drop stale preferences.
 *  5. Resolve conflicts (project overrides user).
 *  6. Generate per-domain summaries.
 *  7. Snapshot, persist, return.
 */
export async function refineProfile(
  deps: ExtractorDeps,
  options: RefineOptions,
): Promise<RefineResult> {
  const now = options.now ?? Date.now();
  const config = deps.getConfig();
  let previous = await storage.getProfile(options.scope, options.projectRoot);
  const signals = await storage.loadSignals(options.scope, options.projectRoot);

  // Defensive filter: if this profile somehow accumulated preferences that are
  // obviously about a completely different project (historical resolution bugs),
  // drop them so they don't poison this project's taste forever.
  if (previous && options.projectRoot) {
    const root = options.projectRoot.toLowerCase();
    const isLikelyResumeProject =
      root.includes("resume") || root.includes("cv");
    previous = {
      ...previous,
      preferences: previous.preferences.filter((p) => {
        const t = p.preference.toLowerCase();
        const resumeSignal =
          t.includes("resume") ||
          t.includes("star format") ||
          t.includes("bullet point");
        if (resumeSignal && !isLikelyResumeProject) return false;
        return true;
      }),
    };
  }
  const extractor: Extractor = pickExtractor(config);

  let extraction: {
    candidates: PreferenceCandidate[];
    discarded?: unknown[];
    provider?: string;
  };
  try {
    extraction = await extractor(signals, {
      ...deps,
      getPriorPreferences: () => previous?.preferences ?? [],
      currentProjectRoot: options.projectRoot,
    });
  } catch (err) {
    console.warn(
      "[engineering-profile] LLM extraction failed (no local fallback; priors will decay, signals re-presented to LLM on next refine):",
      err,
    );
    extraction = { candidates: [], discarded: [], provider: config?.provider };
  }

  const next = previous
    ? cloneProfile(previous, now)
    : makeBlankProfile(options.scope, options.projectRoot, now);

  // 1. Prior preferences - all deduplication, merging of intents, choice of canonical phrasing,
  //    and category assignment MUST come from the LLM via mergedPriorIds / mappedSignalIds / candidate.
  //    No local fuzzy, similarity, or key-based grouping is used for consolidation. The LLM decides.
  const uniquePriors = [...next.preferences];

  // 2. Preprocess extraction candidates. We trust the LLM output exclusively.
  //    (If the LLM returned no candidates this pass, we still carry priors forward for decay + write.)
  const candidatesWithMappings = extraction.candidates.map((candidate) => {
    return {
      ...candidate,
      mergedPriorIds: candidate.mergedPriorIds
        ? [...candidate.mergedPriorIds]
        : [],
      mappedSignalIds: candidate.mappedSignalIds
        ? [...candidate.mappedSignalIds]
        : [],
    };
  });

  // 3. Process candidates and build nextPrefs
  const nextPrefs: Preference[] = [];
  const processedPriorIds = new Set<string>();

  for (const cand of candidatesWithMappings) {
    // Follow LLM-provided mergedPriorIds exactly (no text fuzzy or local key matching).
    // The LLM is responsible for deciding which priors (even cross-category variants) represent
    // the same intent and should be consolidated under this candidate so confidence is refined
    // on a single entry from the full evidence.
    const priors = uniquePriors.filter((p) =>
      cand.mergedPriorIds.includes(p.id),
    );
    const primaryPrior =
      priors.find((p) => p.pinned) ??
      priors.sort((a, b) => b.confidence - a.confidence)[0];

    // Union *all* signals for this intent: the ones the LLM mapped in this candidate *plus*
    // the historical signalIds from every prior the LLM told us to merge. This is what
    // "refine the confidence score" on the consolidated point means.
    const mergedSignalIds = Array.from(
      new Set([
        ...cand.mappedSignalIds,
        ...priors.flatMap((p) => p.signalIds ?? []),
      ]),
    );
    const allEvidenceForIntent = signals.filter((s) =>
      mergedSignalIds.includes(s.id),
    );

    const existingPref = nextPrefs.find((p) =>
      cand.mergedPriorIds.includes(p.id),
    );

    if (existingPref) {
      existingPref.signalIds = Array.from(
        new Set([...existingPref.signalIds, ...mergedSignalIds]),
      );
      existingPref.supportingSources = Array.from(
        new Set([
          ...existingPref.supportingSources,
          ...collectSources(allEvidenceForIntent),
        ]),
      );
      const rawScore = aggregateScore(allEvidenceForIntent, now, config);
      let confidence =
        allEvidenceForIntent.length > 0
          ? normalizeConfidence(rawScore, allEvidenceForIntent)
          : primaryPrior
            ? primaryPrior.confidence
            : existingPref.confidence;
      if (primaryPrior?.pinned) {
        confidence = Math.max(primaryPrior.confidence, confidence);
      }
      existingPref.confidence = anchorConfidence(
        confidence,
        existingPref.signalIds,
        signals,
        config,
        existingPref.pinned,
      );
      existingPref.evidenceCount = allEvidenceForIntent.length;
      if (allEvidenceForIntent.length > 0) {
        existingPref.lastObservedAt = Math.max(
          existingPref.lastObservedAt,
          ...allEvidenceForIntent.map((s) => s.timestamp),
        );
        existingPref.firstObservedAt = Math.min(
          existingPref.firstObservedAt,
          ...allEvidenceForIntent.map((s) => s.timestamp),
        );
      }
      if (primaryPrior?.pinned) {
        existingPref.pinned = true;
      }
      for (const p of priors) {
        processedPriorIds.add(p.id);
      }
      continue;
    }

    const rawScore = aggregateScore(allEvidenceForIntent, now, config);
    let confidence =
      allEvidenceForIntent.length > 0
        ? normalizeConfidence(rawScore, allEvidenceForIntent)
        : primaryPrior
          ? primaryPrior.confidence
          : 0;

    if (primaryPrior?.pinned) {
      confidence = Math.max(primaryPrior.confidence, confidence);
    }
    // No local normalizeText comparison / averaging. LLM chose the phrasing; confidence comes from full evidence.

    const firstObserved =
      allEvidenceForIntent.length > 0
        ? Math.min(...allEvidenceForIntent.map((e) => e.timestamp))
        : (primaryPrior?.firstObservedAt ?? now);
    const lastObserved =
      allEvidenceForIntent.length > 0
        ? Math.max(...allEvidenceForIntent.map((e) => e.timestamp))
        : (primaryPrior?.lastObservedAt ?? now);

    const pref: Preference = {
      id: primaryPrior?.id ?? newPreferenceId(),
      category: cand.category as Domain,
      preference: cand.preference,
      confidence: anchorConfidence(
        confidence,
        mergedSignalIds,
        signals,
        config,
        primaryPrior?.pinned ?? false,
      ),
      evidenceCount: mergedSignalIds.length,
      firstObservedAt: primaryPrior
        ? Math.min(primaryPrior.firstObservedAt, firstObserved)
        : firstObserved,
      lastObservedAt: primaryPrior
        ? Math.max(primaryPrior.lastObservedAt, lastObserved)
        : lastObserved,
      signalIds: mergedSignalIds,
      supportingSources: Array.from(
        new Set(collectSources(allEvidenceForIntent)),
      ),
      scope: options.scope,
      projectRoot: options.projectRoot,
      pinned: primaryPrior?.pinned ?? false,
      supersededBy: null,
    };
    nextPrefs.push(pref);
    for (const p of priors) {
      processedPriorIds.add(p.id);
    }
  }

  // 4. Decay unmapped priors
  for (const prior of uniquePriors) {
    if (processedPriorIds.has(prior.id)) continue;
    let confidence = prior.confidence;
    if (!prior.pinned) {
      const halfLife = Math.max(config.decayHalfLifeMs, 1);
      const age = Math.max(0, now - prior.lastObservedAt);
      const decay = 0.5 ** (age / halfLife);
      confidence = prior.confidence * decay;
    }
    nextPrefs.push({
      ...prior,
      confidence: anchorConfidence(
        confidence,
        prior.signalIds,
        signals,
        config,
        prior.pinned,
      ),
    });
  }

  const demoted = nextPrefs.filter(
    (p) => p.confidence < config.demotionThreshold && !p.pinned,
  );
  const kept = nextPrefs.filter(
    (p) => p.confidence >= config.demotionThreshold || p.pinned,
  );
  kept.sort((a, b) => b.confidence - a.confidence);
  const top = kept.slice(0, config.maxPreferences);
  const dropped: Preference[] = [
    ...demoted,
    ...kept.slice(config.maxPreferences),
  ];
  top.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.lastObservedAt - a.lastObservedAt;
  });

  const nextProfile: Profile = {
    ...next,
    generatedAt: now,
    preferences: top,
    summary: next.summary,
    domains: buildDomainProfiles(top, next.summary, now, config, next.domains),
  };
  nextProfile.summary = nextProfile.summary || generateSummary(top, config);

  const changes = diffChanges(previous?.preferences ?? [], top);
  const snapshot: ProfileSnapshot = {
    id: `snap-${now.toString(36)}`,
    scope: options.scope,
    projectRoot: options.projectRoot,
    createdAt: now,
    reason: options.reason ?? "refine",
    profile: nextProfile,
    changes,
    note: options.note ?? null,
  };

  await storage.saveProfile(nextProfile);
  await storage.appendSnapshot(snapshot);

  return {
    profile: nextProfile,
    snapshot,
    added: changes.filter(addedChange).map((c) => c.after as Preference),
    removed: changes.filter(removedChange).map((c) => c.before as Preference),
    modified: changes.filter(modifiedChange).map((c) => c.after as Preference),
    dropped,
  };
}

const addedChange = (
  c: SnapshotChange,
): c is SnapshotChange & { kind: "added" } => c.kind === "added";
const removedChange = (
  c: SnapshotChange,
): c is SnapshotChange & { kind: "removed" } => c.kind === "removed";
const modifiedChange = (
  c: SnapshotChange,
): c is SnapshotChange & { kind: "modified" } => c.kind === "modified";

export async function rollbackTo(
  snapshotId: string,
  scope: Scope,
  projectRoot: string | null,
): Promise<RefineResult | null> {
  const snapshots = await storage.loadSnapshots(scope, projectRoot);
  const target = snapshots.find((s) => s.id === snapshotId);
  if (!target) return null;
  const current = await storage.getProfile(scope, projectRoot);
  const now = Date.now();
  const restored: Profile = {
    ...target.profile,
    generatedAt: now,
    id: target.profile.id,
  };
  const rollback: ProfileSnapshot = {
    id: `snap-${now.toString(36)}`,
    scope,
    projectRoot,
    createdAt: now,
    reason: "rollback",
    profile: restored,
    changes: diffChanges(current?.preferences ?? [], restored.preferences),
    note: `Rollback to ${target.id}`,
  };
  await storage.saveProfile(restored);
  await storage.appendSnapshot(rollback);
  return {
    profile: restored,
    snapshot: rollback,
    added: rollback.changes
      .filter(addedChange)
      .map((c) => c.after as Preference),
    removed: rollback.changes
      .filter(removedChange)
      .map((c) => c.before as Preference),
    modified: rollback.changes
      .filter(modifiedChange)
      .map((c) => c.after as Preference),
    dropped: [],
  };
}

export function diffChanges(
  prev: ReadonlyArray<Preference>,
  next: ReadonlyArray<Preference>,
): SnapshotChange[] {
  const changes: SnapshotChange[] = [];
  const prevById = new Map<string, Preference>();
  const nextById = new Map<string, Preference>();
  for (const p of prev) prevById.set(p.id, p);
  for (const p of next) nextById.set(p.id, p);

  for (const [id, n] of nextById) {
    const before = prevById.get(id);
    if (!before) {
      changes.push({
        kind: "added",
        preferenceId: n.id,
        category: n.category,
        before: null,
        after: n,
        confidenceDelta: null,
      });
    } else {
      const merged: Preference = {
        ...before,
        preference: n.preference,
        confidence: n.confidence,
        evidenceCount: n.evidenceCount,
        lastObservedAt: n.lastObservedAt,
        signalIds: n.signalIds,
        supportingSources: n.supportingSources,
        firstObservedAt: Math.min(before.firstObservedAt, n.firstObservedAt),
      };
      if (
        merged.preference !== before.preference ||
        Math.abs(merged.confidence - before.confidence) > 0.01
      ) {
        changes.push({
          kind: "modified",
          preferenceId: merged.id,
          category: merged.category,
          before,
          after: merged,
          confidenceDelta: merged.confidence - before.confidence,
        });
      }
    }
  }
  for (const [id, b] of prevById) {
    if (!nextById.has(id)) {
      changes.push({
        kind: "removed",
        preferenceId: b.id,
        category: b.category,
        before: b,
        after: null,
        confidenceDelta: null,
      });
    }
  }
  return changes;
}

export function buildDomainProfiles(
  prefs: ReadonlyArray<Preference>,
  _globalSummary: string,
  now: number,
  config: RefinementConfig = DEFAULT_REFINEMENT_CONFIG,
  prior: Record<string, DomainProfile> = {},
): Record<string, DomainProfile> {
  const grouped = new Map<Domain, Preference[]>();
  for (const p of prefs) {
    const bucket = grouped.get(p.category) ?? [];
    bucket.push(p);
    grouped.set(p.category, bucket);
  }
  const total = prefs.length || 1;
  const out: Record<string, DomainProfile> = {};
  for (const [domain, list] of grouped) {
    const sorted = list.slice().sort((a, b) => b.confidence - a.confidence);
    const avgConfidence =
      sorted.reduce((s, p) => s + p.confidence, 0) / Math.max(1, sorted.length);
    const share = sorted.length / total;
    const priorDomain = prior[domain];
    const shouldSplit = evaluateSplit({
      preferenceCount: sorted.length,
      averageConfidence: avgConfidence,
      share,
      config,
      priorSplit: priorDomain?.split ?? false,
    });
    const splitPath = shouldSplit
      ? `.xterax/${normalizeDomain(domain)}/profile.md`
      : null;
    out[domain] = {
      category: domain,
      summary: sorted.length > 0 ? generateDomainSummary(domain, sorted) : "",
      preferences: sorted,
      updatedAt: now,
      split: shouldSplit,
      splitPath,
    };
  }
  return out;
}

function evaluateSplit(args: {
  preferenceCount: number;
  averageConfidence: number;
  share: number;
  config: RefinementConfig;
  priorSplit: boolean;
}): boolean {
  const { preferenceCount, averageConfidence, share, config, priorSplit } =
    args;
  const meetsThresholds =
    preferenceCount >= config.splitMinPreferences &&
    averageConfidence >= config.splitMinAverageConfidence &&
    share >= config.splitMinShare;
  if (meetsThresholds) return true;
  return priorSplit;
}

export function generateSummary(
  prefs: ReadonlyArray<Preference>,
  _config: RefinementConfig,
): string {
  if (prefs.length === 0) {
    return "No stable preferences recorded yet.";
  }
  const top = prefs.slice(0, 5);
  const bullets = top.map((p) => p.preference);
  return `Top preferences: ${bullets.join("; ")}.`;
}

export function generateDomainSummary(
  domain: Domain,
  prefs: ReadonlyArray<Preference>,
): string {
  if (prefs.length === 0) return "";
  const top = prefs.slice(0, 3);
  return `${domain}: ${top.map((p) => p.preference).join("; ")}.`;
}

export function resolveConflict(
  user: Preference | null,
  project: Preference | null,
): { effective: Preference | null; overridden: Preference | null } {
  if (!user) return { effective: project, overridden: null };
  if (!project) return { effective: user, overridden: null };
  return { effective: project, overridden: user };
}

export function mergeProfiles(
  user: Profile,
  project: Profile | null,
  now: number,
): Profile {
  if (!project) return user;
  const merged: Preference[] = [];
  const seenIds = new Set<string>();
  // Exact normalized match only (no levenshtein similarity / fuzzy). LLM is the source of truth
  // for intent consolidation; this is just last-resort safety for user vs project overlap.
  const exactMatch = (a: string, b: string) =>
    normalizeText(a) === normalizeText(b);
  for (const up of user.preferences) {
    const conflict = project.preferences.find(
      (p) =>
        p.category === up.category && exactMatch(p.preference, up.preference),
    );
    const { effective, overridden } = resolveConflict(up, conflict ?? null);
    if (effective) {
      merged.push({ ...effective, supersededBy: overridden?.id ?? null });
      seenIds.add(effective.id);
      if (conflict && effective.id !== conflict.id) {
        seenIds.add(conflict.id);
      } else if (conflict) {
        seenIds.add(up.id);
      }
    }
  }
  for (const pp of project.preferences) {
    if (seenIds.has(pp.id)) continue;
    const duplicate = merged.find(
      (m) =>
        m.category === pp.category && exactMatch(m.preference, pp.preference),
    );
    if (duplicate) continue;
    merged.push(pp);
  }
  merged.sort((a, b) => b.confidence - a.confidence);
  return {
    ...user,
    generatedAt: now,
    preferences: merged,
    domains: buildDomainProfiles(merged, user.summary, now, undefined, {
      ...user.domains,
      ...project.domains,
    }),
    summary: user.summary,
  };
}

function cloneProfile(p: Profile, now: number): Profile {
  return {
    ...p,
    generatedAt: now,
    preferences: p.preferences.map((x) => ({ ...x })),
    domains: { ...p.domains },
  };
}

function collectSources(signals: ReadonlyArray<Signal>): SignalSource[] {
  const seen = new Set<SignalSource>();
  for (const s of signals) seen.add(s.source);
  return Array.from(seen);
}

/**
 * Deterministic fallback when LLM extraction returns no usable mappings.
 * Groups raw signals by preference text and wires signal IDs directly.
 */
export function buildFallbackCandidates(
  signals: ReadonlyArray<Signal>,
  priors: ReadonlyArray<Preference>,
): PreferenceCandidate[] {
  const groups = new Map<string, Signal[]>();
  for (const s of signals) {
    const key = preferenceKey(s.category, s.preference);
    const bucket = groups.get(key) ?? [];
    bucket.push(s);
    groups.set(key, bucket);
  }
  const out: PreferenceCandidate[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const prior = priors.find(
      (p) =>
        preferenceKey(p.category, p.preference) ===
        preferenceKey(first.category, first.preference),
    );
    out.push({
      category: first.category,
      preference: first.preference,
      evidence: first.evidence,
      weight: 1,
      mergedPriorIds: prior ? [prior.id] : [],
      mappedSignalIds: group.map((s) => s.id),
    });
  }
  return out;
}

function anchorConfidence(
  confidence: number,
  signalIds: ReadonlyArray<string>,
  allSignals: ReadonlyArray<Signal>,
  config: RefinementConfig,
  pinned: boolean,
): number {
  const evidence = allSignals.filter((s) => signalIds.includes(s.id));
  return applyKlAnchor(confidence, evidence, config, pinned);
}

export const _internal = {
  clamp01,
  distinctSourceCount,
};
