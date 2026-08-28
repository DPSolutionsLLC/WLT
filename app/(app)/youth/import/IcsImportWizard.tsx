"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IcsPreviewStep } from "@/app/(app)/youth/import/IcsPreviewStep";
import {
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  fetchProfiles,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { IcsProblemList } from "@/components/youth/IcsProblemList";
import type { IcsImportResult } from "@/lib/youth/ics/applyImport";
import type { IcsImportPreview } from "@/lib/youth/ics/buildImportPreview";
import {
  MAX_ICS_EVENTS,
  formatFileSizeLimit,
  hasAcceptedExtension,
  MAX_ICS_FILE_BYTES,
} from "@/lib/youth/ics/limits";
import type { ActivityProfile } from "@/lib/youth/queries";

// Two steps and a result — choose an activity and a file, read the preview, confirm — mirroring
// app/(app)/roster/import/ImportWizard.tsx.
//
// HOLDS THE `File` ACROSS BOTH REQUESTS, because the confirm uploads it a second time and the
// server re-derives everything from it. Keeping the file rather than the parsed events is what
// makes the confirm payload untamperable: there is nothing in it for a client to rewrite.

type Step = "choose" | "preview" | "done";

type PreviewResponse = {
  preview?: IcsImportPreview;
  problemsTruncated?: number;
  error?: string;
};

type ImportResponse = {
  result?: IcsImportResult;
  problemsTruncated?: number;
  error?: string;
};

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

// Worded exactly as the server's own 400, so the user reads one sentence whichever side catches
// it — the same reason limits.ts holds the size copy for both.
const FILE_CHANGED_ERROR = "The file changed since you previewed it. Preview again.";

// A throw from these fetches is usually NOT a network failure. The browser refuses to upload a
// file that changed on disk since it was chosen — Chrome aborts with ERR_UPLOAD_FILE_CHANGED,
// surfaced as a bare TypeError — which is exactly what happens when somebody re-exports the
// schedule while the preview is open. That request never reaches the server, so the fileHash
// check never gets to answer and "check your connection" is the one thing that is not wrong.
// Re-reading a byte of the file tells the two apart (plans/retros/roster-c-csv-import.md).
async function describeRequestFailure(chosen: File): Promise<string> {
  try {
    await chosen.slice(0, 1).arrayBuffer();
    return NETWORK_ERROR;
  } catch {
    return FILE_CHANGED_ERROR;
  }
}

function labelFor(profile: ActivityProfile): string {
  return `${profile.memberName} — ${profile.activityName}`;
}

// Defect youth-b-D3: the result screen read "1 events updated". The preview screen escapes this
// because it renders labelled counts rather than sentences, and the confirm button already
// pluralised correctly — so the one screen that got it wrong was the one a leader reads last.
function countOfEvents(count: number): string {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

export type IcsImportWizardProps = {
  // SEEDS a shared client query rather than standing as the answer. A Server Component prop never
  // refetches, so an activity created in another tab would be missing from this list until a
  // reload — that shape was defect youth-a-D2.
  initialProfiles: ActivityProfile[];
};

export function IcsImportWizard({ initialProfiles }: IcsImportWizardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: initialProfiles,
  });

  // EVERY PROFILE IN THE WARD, not only ones this user could edit (Decision 4).
  // `activity_calendars` and `activity_events` keep migration 019's ward-wide write policies, so
  // the API genuinely allows all of them. Filtering here would hide a control the API allows,
  // which is the mirror of defect youth-a-D1 and just as wrong.
  const profiles = profilesQuery.data ?? [];

  const [step, setStep] = useState<Step>("choose");
  const [profileId, setProfileId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<IcsImportPreview | null>(null);
  const [result, setResult] = useState<IcsImportResult | null>(null);
  const [problemsTruncated, setProblemsTruncated] = useState(0);
  const [formError, setFormError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);

  const chosenProfile = profiles.find((profile) => profile.id === profileId);
  const activityLabel = chosenProfile === undefined ? "this activity" : labelFor(chosenProfile);

  function restart(): void {
    setStep("choose");
    setFile(null);
    setPreview(null);
    setResult(null);
    setProblemsTruncated(0);
    setFormError(undefined);
  }

  async function handlePreview(): Promise<void> {
    if (!file) return;

    setFormError(undefined);
    setIsBusy(true);

    const body = new FormData();
    body.set("file", file);
    body.set("profileId", profileId);

    try {
      const response = await fetch("/api/youth/calendars/import/preview", {
        method: "POST",
        body,
      });
      const payload: PreviewResponse = await response.json();

      if (!response.ok || !payload.preview) {
        setFormError(payload.error ?? "Could not read that calendar file. Please try again.");
        return;
      }

      setPreview(payload.preview);
      setProblemsTruncated(payload.problemsTruncated ?? 0);
      setStep("preview");
    } catch (error) {
      console.error("Could not build the calendar import preview", error);
      setFormError(await describeRequestFailure(file));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!file || !preview) return;

    setFormError(undefined);
    setIsBusy(true);

    const body = new FormData();
    body.set("file", file);
    body.set("profileId", profileId);
    // The hash the preview computed. A file edited in between comes back as a 400 telling the
    // user to preview again, rather than a silent import of different data.
    body.set("fileHash", preview.fileHash);

    try {
      const response = await fetch("/api/youth/calendars/import", { method: "POST", body });
      const payload: ImportResponse = await response.json();

      if (!response.ok || !payload.result) {
        setFormError(payload.error ?? "Could not import that calendar file. Please try again.");
        return;
      }

      setResult(payload.result);
      setProblemsTruncated(payload.problemsTruncated ?? 0);
      setStep("done");

      // ---------------------------------------------------------------------------
      // INVALIDATE BEFORE THE USER CAN NAVIGATE BACK. THIS IS THE THIRD APPEARANCE OF THIS BUG.
      // ---------------------------------------------------------------------------
      // TanStack's cache SURVIVES client-side navigation, and this wizard finishes on a different
      // route from /youth. Without these two lines the user follows the link back to the schedule
      // and finds it does not contain what they just imported — visits-b stated the rule,
      // youth-a shipped the defect anyway (youth-a-D2), and PROFILE_MUTATION_INVALIDATES exists
      // in youthQueries.ts for exactly this reason.
      //
      // router.refresh() alone is not enough: TanStack reads `initialData` once, on first mount.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [YOUTH_EVENTS_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [YOUTH_PROFILES_QUERY_KEY] }),
      ]);
      router.refresh();
    } catch (error) {
      console.error("Could not import the calendar file", error);
      setFormError(await describeRequestFailure(file));
    } finally {
      setIsBusy(false);
    }
  }

  if (step === "preview" && preview) {
    return (
      <IcsPreviewStep
        preview={preview}
        problemsTruncated={problemsTruncated}
        activityLabel={activityLabel}
        onBack={() => {
          setFormError(undefined);
          setPreview(null);
          setStep("choose");
        }}
        onConfirm={handleConfirm}
        isBusy={isBusy}
        error={formError}
      />
    );
  }

  if (step === "done" && result) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="text-base font-semibold text-foreground">Import finished</h2>
          {/* THE SAME FOUR NUMBERS THE PREVIEW SHOWED, under the same labels, and taken from the
              SERVER's response rather than from the preview's estimate. A write refused by policy
              is a zero-row success, and reporting the estimate would call that a success too. */}
          <ul className="mt-3 text-sm text-muted">
            <li>{countOfEvents(result.created)} created</li>
            <li>{countOfEvents(result.updated)} updated</li>
            <li>{countOfEvents(result.unchanged)} already correct</li>
            <li>
              {countOfEvents(result.notInFile.length)} in the app and not in this file — unchanged
              by this import
            </li>
          </ul>
          <Link
            href="/youth"
            className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
          >
            Go to the schedule
          </Link>
        </Card>

        <IcsProblemList
          problems={result.problems}
          problemsTruncated={problemsTruncated}
          emptyMessage="Every entry in the file imported."
        />

        <div>
          <Button variant="secondary" onClick={restart}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-base font-semibold text-foreground">Choose the activity and file</h2>
        <p className="mt-2 text-sm text-muted">
          Export the schedule from the school or league calendar as an .ics file, then choose it
          here. Up to {MAX_ICS_EVENTS} events and {formatFileSizeLimit()}.
        </p>
        <p className="mt-2 text-sm text-muted">
          Nothing is written until you have seen the preview and confirmed it. An import never
          deletes an event and never cancels one.
        </p>

        {profiles.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            There are no activities to import into yet. Add one on the youth activities page
            first.
          </p>
        ) : (
          <>
            <label
              htmlFor="youth-import-profile"
              className="mt-4 block text-sm font-medium text-foreground"
            >
              Which activity
            </label>
            <select
              id="youth-import-profile"
              className="mt-1.5 block w-full min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              value={profileId}
              disabled={isBusy}
              onChange={(event) => {
                setProfileId(event.target.value);
                setFormError(undefined);
              }}
            >
              <option value="">Choose an activity…</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {labelFor(profile)}
                </option>
              ))}
            </select>

            <label
              htmlFor="youth-import-file"
              className="mt-4 block text-sm font-medium text-foreground"
            >
              Calendar file
            </label>
            <input
              id="youth-import-file"
              type="file"
              accept=".ics,.ical,.ifb,text/calendar"
              disabled={isBusy}
              className="mt-1.5 block w-full min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFormError(undefined);

                if (chosen === null) {
                  setFile(null);
                  return;
                }

                // A courtesy check only; assertAcceptableIcsFile() on the server is the boundary.
                // Doing it here saves the user an upload before being told the file is a .png.
                if (!hasAcceptedExtension(chosen.name)) {
                  setFile(null);
                  setFormError(
                    "That file is not a .ics. Export the schedule from the school or league " +
                      "calendar and try again.",
                  );
                  return;
                }

                if (chosen.size > MAX_ICS_FILE_BYTES) {
                  setFile(null);
                  setFormError(
                    `That file is larger than ${formatFileSizeLimit()}. Export one season at a time.`,
                  );
                  return;
                }

                setFile(chosen);
              }}
            />

            <FormError message={formError} />

            <div className="mt-4">
              <Button
                onClick={handlePreview}
                disabled={isBusy || file === null || profileId === ""}
              >
                {isBusy ? "Reading the file…" : "See what this will do"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
