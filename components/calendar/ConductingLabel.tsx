export type ConductingLabelProps = {
  conductingUserId: string | null;
  names: Record<string, string>;
  // REQUIRED, never defaulted. A default would let a new call site silently render "Not set" for
  // a Sunday that holds no meeting, which is the exact ambiguity this prop exists to remove — and
  // a defaulted parameter is how 25 call sites came to ignore a ward's role access
  // (plans/retros/role-access-overrides.md). The compiler should enumerate every place that has
  // to decide.
  holdsMeeting: boolean;
};

// "Not set" and "No meeting" are DIFFERENT FACTS. The first means the rotation reaches this
// Sunday and nobody is in the position; the second means there is no meeting to conduct at all.
// Rendering the first for the second is indistinguishable from an unfilled rotation position, and
// that ambiguity cost a debugging session.
//
// Never renders a raw uuid. An id with no matching name reads as "Not set" for the same reason a
// null one does: the conductor is not somebody the reader can act on, and a uuid on screen tells
// them nothing they could use. The id belongs to a deactivated or removed account, which the
// admin pages surface properly.
export function ConductingLabel({
  conductingUserId,
  names,
  holdsMeeting,
}: ConductingLabelProps) {
  // The id is ignored entirely rather than checked first. A Sunday with no meeting has no
  // conductor by construction (migration 027's CHECK), and if a stale id survived anyway, naming
  // somebody who is not conducting would be worse than saying nothing.
  if (!holdsMeeting) {
    return <span className="text-muted">No meeting</span>;
  }

  const name = conductingUserId ? names[conductingUserId] : undefined;

  if (!name) {
    return <span className="text-muted">Not set</span>;
  }

  return <span className="text-foreground">{name}</span>;
}
