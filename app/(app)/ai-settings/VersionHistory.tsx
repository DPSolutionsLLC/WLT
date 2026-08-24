"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { AiSettings } from "@/types/domain";

// Newest first, the current one badged Active. Restoring APPENDS — the confirm step is worded by
// consequence the way calendar-b's 409 dialog is, because "restore" is the one word here that
// could reasonably be read as "throw away what came after".

// Structurally the same as `AiSettingsVersion` in lib/ai/queries.ts, declared here rather than
// imported from it: that module reaches next/headers, and a client component must not import one
// that does — not even for a type (plans/retros/roster-b-picker-and-orgs.md).
type SettingsVersion = AiSettings & { savedByName: string | null };

export type VersionHistoryProps = {
  initialVersions: SettingsVersion[];
  activeVersionId: string | null;
  canManage: boolean;
};

const CONFIRM_MESSAGE =
  "Restoring makes this the active configuration. Your current settings stay in the history — " +
  "nothing is deleted.";

// UTC, matching formatStamp in ContactStagePanel.tsx. Never round-trip a timestamptz through
// local time — the date a version was saved must read the same for everyone in the ward.
function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function VersionHistory({
  initialVersions,
  activeVersionId,
  canManage,
}: VersionHistoryProps) {
  const router = useRouter();

  const [pendingId, setPendingId] = useState<string>();
  const [restoringId, setRestoringId] = useState<string>();
  const [restoredNote, setRestoredNote] = useState<string>();
  const [historyError, setHistoryError] = useState<string>();

  async function restore(id: string) {
    setHistoryError(undefined);
    setRestoredNote(undefined);
    setRestoringId(id);

    try {
      const response = await fetch(`/api/ai-settings/restore/${id}`, { method: "POST" });
      const body: { error?: string } = await response.json();

      if (!response.ok) {
        setHistoryError(body.error ?? "Could not restore that version. Please try again.");
        return;
      }

      setPendingId(undefined);
      // Said out loud rather than left to be inferred from the form changing above. A restore
      // moves two things at once, and a user who was watching one will not have seen the other.
      setRestoredNote(
        "Restored. The settings above now show this version, and it has been added to the top of the history.",
      );
      router.refresh();
    } catch (error) {
      console.error("Could not restore an AI settings version", error);
      setHistoryError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRestoringId(undefined);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-foreground">Version history</h2>

      {initialVersions.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Nothing saved yet. The first save appears here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {initialVersions.map((version) => (
            <li
              key={version.id}
              className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">
                  Saved by {version.savedByName ?? "someone no longer in the ward"} on{" "}
                  {formatStamp(version.createdAt)}
                </span>
                {version.id === activeVersionId && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    Active
                  </span>
                )}
              </div>

              {/* Hidden entirely when the role cannot manage, rather than disabled — a disabled
                  control reads as "this is coming". */}
              {canManage && version.id !== activeVersionId && (
                <div className="flex flex-col gap-2">
                  {pendingId === version.id ? (
                    <>
                      <p className="text-sm text-muted">{CONFIRM_MESSAGE}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={restoringId === version.id}
                          onClick={() => restore(version.id)}
                        >
                          {restoringId === version.id ? "Restoring…" : "Restore this version"}
                        </Button>
                        <Button variant="secondary" onClick={() => setPendingId(undefined)}>
                          Keep what I have
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div>
                      <Button variant="secondary" onClick={() => setPendingId(version.id)}>
                        Restore
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {restoredNote && (
        <p role="status" className="mt-3 text-sm text-muted">
          {restoredNote}
        </p>
      )}

      <FormError message={historyError} />
    </Card>
  );
}
