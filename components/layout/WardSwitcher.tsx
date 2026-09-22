"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

// THE CONTROL P2 DELIBERATELY DID NOT BUILD. app/api/session/active-ward/route.ts has existed
// since migration 068 with a header saying the switcher is a P3 chrome component; this is it.
//
// ---------------------------------------------------------------------------
// THE LIST COMES FROM THE ROUTE, NEVER FROM A TABLE READ
// ---------------------------------------------------------------------------
// `wards_select` is `id = current_ward_id()`, so an ordinary read of `wards` returns exactly the
// ward you are already standing in — the control could never offer the one you want. The route
// calls `switchable_wards()`, a security definer function, which is the only thing that can
// answer "which wards do you hold a calling in".
//
// ---------------------------------------------------------------------------
// IT RENDERS NOTHING AT ALL WHEN THE LIST IS EMPTY
// ---------------------------------------------------------------------------
// listSwitchableWards() returns [] for somebody holding ONE calling — deliberately `<= 1` rather
// than `=== 1`, so a session with no calling also gets nothing rather than an empty control.
// Everybody holds a calling in their own ward, so this is the line that keeps a pointless
// switcher off every ordinary leader's chrome bar. "Anyone who belongs to one ward never sees
// the unit layer at all" is a stated requirement (CLAUDE.md §7), not a nicety. Scenario 065 is
// the cheap proof and should be re-walked after this lands.
//
// ---------------------------------------------------------------------------
// NOTHING IS IMPORTED FROM THE ROUTE FILE
// ---------------------------------------------------------------------------
// Its header warns that a "use client" component importing a constant out of it would pull
// next/headers into the browser bundle, which ONLY `npm run build` catches (youth-b, youth-c).
// The refusal sentence is the route's own and is SURFACED, not re-invented here — a second
// wording is a second answer to "why was I refused".

type SwitchableWard = { wardId: string; name: string };

type ActiveWardResponse = {
  wards?: SwitchableWard[];
  activeWardId?: string | null;
  homeWardId?: string | null;
  error?: string;
};

export function WardSwitcher() {
  const router = useRouter();
  const [wards, setWards] = useState<SwitchableWard[]>([]);
  const [activeWardId, setActiveWardId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/session/active-ward");
        const body: ActiveWardResponse = await response.json();

        if (!isMounted) return;

        if (!response.ok) {
          // NOT SWALLOWED (rule 7). A switcher that silently shows nothing is
          // indistinguishable from a leader who holds one calling, which is the common case —
          // so the one person it matters to would never find out.
          setErrorMessage(body.error ?? "Could not load the wards you may act in.");
          return;
        }

        setWards(body.wards ?? []);
        setActiveWardId(body.activeWardId ?? body.homeWardId ?? null);
      } catch (error) {
        if (!isMounted) return;
        console.error("Could not load the switchable wards", error);
        setErrorMessage("Could not load the wards you may act in.");
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSwitch(wardId: string): Promise<void> {
    setIsSwitching(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/session/active-ward", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeWardId: wardId }),
      });
      const body: ActiveWardResponse = await response.json();

      if (!response.ok) {
        setErrorMessage(body.error ?? "Could not switch wards. Please try again.");
        setIsSwitching(false);
        return;
      }

      setActiveWardId(wardId);
      // Every Server Component on the page resolved its rows against the OLD ward, so the whole
      // tree has to be re-fetched. Without this the frame would name one ward around another's
      // rows, which is the failure CLAUDE.md §7 describes.
      router.refresh();
      setIsSwitching(false);
    } catch (error) {
      console.error("The ward switch request failed", error);
      setErrorMessage("Could not switch wards. Please try again.");
      setIsSwitching(false);
    }
  }

  // See the header: one calling is not a choice, and the route has already decided that.
  if (wards.length === 0) {
    return errorMessage === null ? null : <FormError message={errorMessage} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">Acting in</p>
      <ul className="flex flex-col gap-1">
        {wards.map((ward) => {
          const isActive = ward.wardId === activeWardId;

          return (
            <li key={ward.wardId}>
              <Button
                variant={isActive ? "primary" : "secondary"}
                onClick={() => void handleSwitch(ward.wardId)}
                disabled={isSwitching || isActive}
                aria-current={isActive ? "true" : undefined}
                className="w-full justify-start"
              >
                {ward.name}
                {isActive ? <span className="text-xs">· current</span> : null}
              </Button>
            </li>
          );
        })}
      </ul>
      {errorMessage === null ? null : <FormError message={errorMessage} />}
    </div>
  );
}
