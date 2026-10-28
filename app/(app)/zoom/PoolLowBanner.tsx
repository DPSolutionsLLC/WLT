import type { PoolLevel } from "@/lib/zoom/joinLinkPool";

// The low / empty pool warning (ITER-053, P1). Computed on read from the free count and shown to
// the bishopric above the tabs. No notification is sent.

export function PoolLowBanner({ level }: { level: PoolLevel }) {
  if (level.tone === "ok" || !level.sentence) return null;

  return (
    <p
      role="status"
      className="rounded-md border border-warning px-3 py-2 text-sm text-foreground"
    >
      {level.sentence}
    </p>
  );
}
