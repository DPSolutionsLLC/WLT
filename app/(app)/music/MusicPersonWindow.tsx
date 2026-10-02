"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { MAX_MUSIC_PERSON_NAME_LENGTH } from "@/lib/validation/music";

// Choosing a chorister or organist (ITER-038 slice ma) — SpeakerWindow's shape, smaller: one search
// box over the roster, and "Use … as typed" for somebody the roster does not have (a visiting
// organist). Choosing saves at once; there is nothing else in the window to fill.
//
// THE MEMBERS ARRIVE SLIM — id and name only, active members only — so no phone or address reaches
// the browser for a list of names (SpeakerWindow's rule).

const LINK_BUTTON =
  "min-h-11 px-2 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60";

export type MusicDirectoryEntry = { id: string; firstName: string; lastName: string };

export type MusicPersonChoice = { memberId: string } | { name: string };

export type MusicPersonWindowProps = {
  roleLabel: string;
  members: readonly MusicDirectoryEntry[];
  isSaving: boolean;
  errorMessage: string | undefined;
  onChoose: (choice: MusicPersonChoice) => void;
  onClose: () => void;
};

function fullName(member: MusicDirectoryEntry): string {
  return `${member.firstName} ${member.lastName}`.trim();
}

export function MusicPersonWindow({
  roleLabel,
  members,
  isSaving,
  errorMessage,
  onChoose,
  onClose,
}: MusicPersonWindowProps) {
  const searchId = useId();
  const [search, setSearch] = useState("");

  const term = search.trim().toLowerCase();
  const listed = members
    .filter((member) => term === "" || fullName(member).toLowerCase().includes(term))
    .sort((left, right) => fullName(left).localeCompare(fullName(right)));

  return (
    <Modal isOpen onClose={onClose} title={`Choose the ${roleLabel.toLowerCase()}`}>
      <div className="flex flex-col gap-3">
        <Input
          id={searchId}
          label={roleLabel}
          value={search}
          maxLength={MAX_MUSIC_PERSON_NAME_LENGTH}
          autoFocus
          disabled={isSaving}
          placeholder="Search by name, or type someone not on the roster…"
          onChange={(event) => setSearch(event.target.value)}
        />

        {term !== "" && (
          <button
            type="button"
            className={`${LINK_BUTTON} self-start px-0 text-left`}
            disabled={isSaving}
            onClick={() => onChoose({ name: search.trim() })}
          >
            Can&apos;t find them? Use &ldquo;{search.trim()}&rdquo; as typed
          </button>
        )}

        {listed.length === 0 ? (
          <p className="text-sm text-muted">
            {term === "" ? "Nobody on the roster to list." : "Nobody on the roster matches."}
          </p>
        ) : (
          <ul
            aria-label="Ward members"
            className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border"
          >
            {listed.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => onChoose({ memberId: member.id })}
                  className="flex min-h-11 w-full items-center px-3 py-1 text-left text-sm font-medium text-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                >
                  {fullName(member)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <FormError message={errorMessage} />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            {isSaving ? "Saving…" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
