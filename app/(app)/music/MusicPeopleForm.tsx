"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  MusicPersonWindow,
  type MusicDirectoryEntry,
  type MusicPersonChoice,
} from "@/app/(app)/music/MusicPersonWindow";
import { FormError } from "@/components/ui/FormError";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";
import type { MusicPerson, SundayMusic } from "@/types/domain";

// The chorister and organist on a Sunday's music card (ITER-038 slice ma).
//
// Two compact lines. Pressing a line opens a window to choose somebody; ✕ clears them. Nobody
// chosen reads "Not chosen yet" — an absence renders as an absence (talks-c), never "None", which
// reads as a decision somebody made.
//
// Without `music.manage` the lines are plain text and nothing opens, as the card already does for
// the musical number.

type Role = "chorister" | "organist";

const ROLE_LABELS: Record<Role, string> = {
  chorister: "Chorister",
  organist: "Organist",
};

const ROLES: readonly Role[] = ["chorister", "organist"];

const LINE_BUTTON =
  "flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-md px-1 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60";

export type MusicPeopleFormProps = {
  sundayId: string;
  sundayMusic: SundayMusic;
  members: readonly MusicDirectoryEntry[];
  canManage: boolean;
};

function PersonValue({ person }: { person: MusicPerson | null }) {
  if (person === null) return <span className="text-sm text-muted">Not chosen yet</span>;
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
      {person.name}
      {person.memberId === null && <span className="text-xs text-muted">Not on the roster</span>}
    </span>
  );
}

export function MusicPeopleForm({ sundayId, sundayMusic, members, canManage }: MusicPeopleFormProps) {
  const router = useRouter();
  const [choosing, setChoosing] = useState<Role | null>(null);
  const [savingRole, setSavingRole] = useState<Role | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function save(role: Role, person: MusicPersonChoice | null): Promise<boolean> {
    setErrorMessage(undefined);
    setSavingRole(role);

    try {
      const response = await fetch(`/api/sundays/${sundayId}/music`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [role]: person }),
      });
      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not save the chorister or organist. Please try again."),
        );
        return false;
      }

      router.refresh();
      return true;
    } catch (error) {
      console.error("Could not save a chorister or organist", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setSavingRole(null);
    }
  }

  async function choose(person: MusicPersonChoice): Promise<void> {
    if (choosing === null) return;
    if (await save(choosing, person)) setChoosing(null);
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <ul className="flex flex-col gap-1">
        {ROLES.map((role) => {
          const person = sundayMusic[role];
          const label = ROLE_LABELS[role];

          return (
            <li key={role} className="flex items-center gap-1">
              {canManage ? (
                <button
                  type="button"
                  className={LINE_BUTTON}
                  disabled={savingRole !== null}
                  onClick={() => {
                    setErrorMessage(undefined);
                    setChoosing(role);
                  }}
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">
                    {label}
                  </span>
                  <PersonValue person={person} />
                </button>
              ) : (
                <div className="flex min-h-11 flex-1 flex-col justify-center px-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">
                    {label}
                  </span>
                  <PersonValue person={person} />
                </div>
              )}

              {canManage && person !== null && (
                <button
                  type="button"
                  aria-label={`Clear the ${label.toLowerCase()}`}
                  disabled={savingRole !== null}
                  onClick={() => void save(role, null)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {choosing === null && <FormError message={errorMessage} />}

      {choosing !== null && (
        <MusicPersonWindow
          roleLabel={ROLE_LABELS[choosing]}
          members={members}
          isSaving={savingRole !== null}
          errorMessage={errorMessage}
          onChoose={(person) => void choose(person)}
          onClose={() => {
            setErrorMessage(undefined);
            setChoosing(null);
          }}
        />
      )}
    </div>
  );
}
