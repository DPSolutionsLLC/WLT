"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { MusicalNumber } from "@/lib/music/queries";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";

// Who is performing, and what.
//
// THE PERFORMER IS A TEXT BOX AND NOT roster-b's MemberPicker. A visiting quartet has no member
// record, "the Primary children" is not a person, and a returned missionary may have moved out
// of the roster already — all three are normal answers a member id could not hold. roster-b froze
// MemberPicker's interface; this is a case for not reaching for it at all.

export type MusicalNumberFormProps = {
  sundayId: string;
  musicalNumber: MusicalNumber | null;
};

export function MusicalNumberForm({ sundayId, musicalNumber }: MusicalNumberFormProps) {
  const router = useRouter();
  const formId = useId();

  const [performer, setPerformer] = useState(musicalNumber?.performer ?? "");
  const [pieceTitle, setPieceTitle] = useState(musicalNumber?.pieceTitle ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const isEmpty = performer.trim() === "" && pieceTitle.trim() === "";

  async function send(method: "POST" | "DELETE"): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);

    try {
      const response = await fetch("/api/musical-numbers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          method === "DELETE"
            ? { sundayId }
            : { sundayId, performer: performer.trim(), pieceTitle: pieceTitle.trim() },
        ),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not save the musical number. Please try again."),
        );
        return;
      }

      if (method === "DELETE") {
        setPerformer("");
        setPieceTitle("");
      }

      router.refresh();
    } catch (error) {
      console.error("Could not save a musical number", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          id={`${formId}-performer`}
          label="Performer"
          value={performer}
          disabled={isSaving}
          placeholder="A name, a group, or the Primary children"
          onChange={(event) => setPerformer(event.target.value)}
        />
        <Input
          id={`${formId}-piece`}
          label="Piece"
          value={pieceTitle}
          disabled={isSaving}
          onChange={(event) => setPieceTitle(event.target.value)}
        />
      </div>

      <FormError message={errorMessage} />

      <div className="flex flex-wrap gap-2">
        {/* Disabled while both boxes are empty rather than saving a row of nulls. An empty
            musical number would make the printed programme render a blank line on a Sunday that
            has none — the same guard MeetingOrderForm already applies in the program builder. */}
        <Button
          className="self-start"
          disabled={isSaving || isEmpty}
          onClick={() => void send("POST")}
        >
          {isSaving ? "Saving…" : "Save the musical number"}
        </Button>
        {musicalNumber !== null && (
          <Button
            variant="secondary"
            disabled={isSaving}
            onClick={() => void send("DELETE")}
          >
            Remove it
          </Button>
        )}
      </div>
    </div>
  );
}
