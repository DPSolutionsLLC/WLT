// Which subjects are an organization's to look after, resolved.
//
// ---------------------------------------------------------------------------
// PURE, AND CLIENT-IMPORTABLE. IT IMPORTS NOTHING.
// ---------------------------------------------------------------------------
// This file exists BECAUSE lib/visits/stewardship.ts imports createServerSupabaseClient, which
// imports next/headers — so anything importing that module becomes server-only and any client
// component reaching for this rule would be unbuildable. It is the same split
// lib/roster/organizationScope.ts made out of lib/roster/organizations.ts, for the same reason
// (plans/retros/roster-b-picker-and-orgs.md).
//
// Do not add an import to this file. Not a type from a server module, not a helper that
// transitively touches one.
//
// ---------------------------------------------------------------------------
// IT NAMES NEITHER HOUSEHOLDS NOR VISITS, ON PURPOSE
// ---------------------------------------------------------------------------
// `subjectId`, never `householdId`. Phase 8's youth-activity coverage asks the identical
// question about youth — "which of these are ours?" — and should import this rather than write a
// second meaning of the word. lib/visits/cadence.ts and householdVisitPriority() already keep
// this discipline for the same reason, and tests/lib/stewardshipScope.test.ts pins it with a
// case built from youth ids.
//
// Do not "tidy" these names to be visit-specific.

export type StewardshipScope = {
  // FALSE means this organization has narrowed NOTHING and everything is in scope.
  //
  // It is NOT the same as an empty `subjectIds`, which would mean it had narrowed to nothing.
  // Absence of rows is the default, exactly as it is for a household cadence override — so an
  // organization that has never opened the control is measured against the whole ward, and its
  // dashboard is unchanged on the day this ships.
  hasNarrowed: boolean;
  subjectIds: ReadonlySet<string>;
};

// The ONLY way an empty `subjectIds` arises is alongside `hasNarrowed: false`. That is why an
// empty bulk replace is REFUSED at the boundary (EMPTY_STEWARDSHIP_MESSAGE in
// lib/validation/visit.ts) rather than written: with one table, "narrowed to nothing" and "not
// narrowed" would be the same zero rows, and silently choosing the second for somebody is how an
// organization ends up measured against two hundred households it did not ask for.
export function toStewardshipScope(subjectIds: readonly string[]): StewardshipScope {
  return {
    hasNarrowed: subjectIds.length > 0,
    subjectIds: new Set(subjectIds),
  };
}

// ONE LINE, AND THE WHOLE SHIP-DAY NO-CHANGE GUARANTEE RESTS ON IT. An organization that has
// narrowed nothing answers `true` for every subject there has ever been, so every existing
// denominator is untouched.
export function isInScope(scope: StewardshipScope, subjectId: string): boolean {
  if (!scope.hasNarrowed) return true;
  return scope.subjectIds.has(subjectId);
}

export type StewardshipDrift = {
  // Derived but not stored — a family that now has a member of this organization.
  toAdd: string[];
  // Stored but no longer derived — a family that no longer does.
  toRemove: string[];
};

// Compares the STORED set against a freshly DERIVED one, so staleness is VISIBLE rather than
// silent. Derivation is deliberately not the storage model — an Elders Quorum's stewardship is a
// hand-drawn ministering district rather than "households containing an elder" — so the stored
// set is authoritative and this only ever offers a reconciliation.
//
// An UN-NARROWED organization has no drift, because it has made no claim to have drifted from.
// Both arrays come back empty regardless of what was derived, and the panel says "measured
// against the whole ward" rather than offering to reconcile something that was never chosen.
//
// Both arrays are SORTED, so two callers rendering the same drift cannot disagree on order.
export function compareStewardshipDrift(
  scope: StewardshipScope,
  derivedSubjectIds: readonly string[],
): StewardshipDrift {
  if (!scope.hasNarrowed) return { toAdd: [], toRemove: [] };

  const derived = new Set(derivedSubjectIds);

  const toAdd = [...derived].filter((id) => !scope.subjectIds.has(id)).sort();
  const toRemove = [...scope.subjectIds].filter((id) => !derived.has(id)).sort();

  return { toAdd, toRemove };
}
