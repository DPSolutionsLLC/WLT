import type { MemberStatus } from "@/types/domain";

export type MemberStatusBadgeProps = {
  status: MemberStatus;
};

// The label is always rendered, never replaced by colour alone. "Do Not Contact" is the one
// that matters — a member whose only marker is a red dot is a member somebody will phone by
// mistake, and a colour-blind or greyscale reader has no marker at all (Phase 12 audits this).
const LABELS: Record<MemberStatus, string> = {
  active: "Active",
  moved_out: "Moved Out",
  do_not_contact: "Do Not Contact",
};

// Theme tokens only. A hardcoded hex here breaks dark mode (conventions.md §Styling).
const CLASSES: Record<MemberStatus, string> = {
  active: "border-border bg-surface text-muted",
  moved_out: "border-border bg-surface text-muted line-through",
  do_not_contact: "border-danger bg-surface text-danger font-semibold",
};

export function MemberStatusBadge({ status }: MemberStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CLASSES[status]}`}
    >
      {status === "do_not_contact" && (
        <span aria-hidden="true" className="mr-1">
          ⚠
        </span>
      )}
      {LABELS[status]}
    </span>
  );
}
