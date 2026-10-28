import type { PositionHolder, RemoteLinkRecord } from "@/lib/zoom/remoteLinks";
import { REMOTE_LINK_POSITION_LABELS } from "@/lib/zoom/remoteLinkPositions";
import type { RemoteLinkPosition } from "@/types/domain";

// What one row of the Remote links tab says. Pure: the page and the PUT/DELETE routes both build
// their row through here, so the tab reads the same after a save as after a reload.

export type RemoteLinkRowState =
  | "vacant"
  | "multiple_holders"
  | "no_link"
  | "live"
  | "needs_new_link"
  | "turned_off";

export type RemoteLinkRow = {
  position: RemoteLinkPosition;
  positionLabel: string;
  state: RemoteLinkRowState;
  holderLine: string;
  holderName: string | null;
  statusLine: string;
  canPaste: boolean;
  canTurnOff: boolean;
};

// A date-only "when did this happen" stamp renders in UTC (CLAUDE.md rule 12, second case).
const STAMP_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatStamp(iso: string): string {
  return STAMP_DATE.format(new Date(iso));
}

function holderDisplayName(holder: PositionHolder): string {
  const name = [holder.firstName, holder.lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : (holder.email ?? "Unnamed account");
}

function describeHolders(holders: PositionHolder[]): string {
  return holders
    .map((holder) => {
      const name = holderDisplayName(holder);
      return holder.email && holder.email !== name ? `${name} · ${holder.email}` : name;
    })
    .join("; ");
}

function byWhom(name: string | null): string {
  return name ? ` by ${name}` : "";
}

export function describeRemoteLinkRow(params: {
  position: RemoteLinkPosition;
  holders: PositionHolder[];
  link: RemoteLinkRecord | null;
}): RemoteLinkRow {
  const { position, holders, link } = params;
  const base = {
    position,
    positionLabel: REMOTE_LINK_POSITION_LABELS[position],
    holderLine: holders.length === 0 ? "No one called" : describeHolders(holders),
    holderName: holders.length === 1 ? holderDisplayName(holders[0]) : null,
  };

  if (holders.length === 0) {
    return {
      ...base,
      state: "vacant",
      statusLine: "Nobody to give a link to.",
      canPaste: false,
      canTurnOff: link !== null && link.deactivatedAt === null,
    };
  }

  const isLive = link !== null && link.deactivatedAt === null;

  if (holders.length > 1) {
    return {
      ...base,
      state: "multiple_holders",
      statusLine: "More than one person holds this calling.",
      canPaste: false,
      canTurnOff: isLive,
    };
  }

  const [holder] = holders;

  if (link === null) {
    return { ...base, state: "no_link", statusLine: "No link set.", canPaste: true, canTurnOff: false };
  }

  const lastFor = link.holderName ?? "someone no longer in this calling";

  if (isLive && link.holderCallingId === holder.callingId) {
    return {
      ...base,
      state: "live",
      statusLine: `Link set ${formatStamp(link.setAt)}${byWhom(link.setByName)}.`,
      canPaste: true,
      canTurnOff: true,
    };
  }

  if (isLive || link.deactivatedReason === "holder_changed") {
    return {
      ...base,
      state: "needs_new_link",
      statusLine: `Needs a new link — the last one was for ${lastFor}.`,
      canPaste: true,
      canTurnOff: isLive,
    };
  }

  return {
    ...base,
    state: "turned_off",
    statusLine: `Turned off ${formatStamp(link.deactivatedAt ?? link.setAt)}${byWhom(link.deactivatedByName)}.`,
    canPaste: true,
    canTurnOff: false,
  };
}
