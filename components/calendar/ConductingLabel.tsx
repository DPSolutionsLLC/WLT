export type ConductingLabelProps = {
  conductingUserId: string | null;
  names: Record<string, string>;
};

// Never renders a raw uuid. An id with no matching name reads as "Not set" for the same reason a
// null one does: the conductor is not somebody the reader can act on, and a uuid on screen tells
// them nothing they could use. The id belongs to a deactivated or removed account, which the admin
// pages surface properly.
export function ConductingLabel({ conductingUserId, names }: ConductingLabelProps) {
  const name = conductingUserId ? names[conductingUserId] : undefined;

  if (!name) {
    return <span className="text-muted">Not set</span>;
  }

  return <span className="text-foreground">{name}</span>;
}
