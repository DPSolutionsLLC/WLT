"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import type { Unit, UnitType } from "@/types/domain";

// STAKES AND WARDS. Create a stake, nest wards under it, and record the real unit numbers.
//
// BUILD NO AREA OR DISTRICT SCREENS (CLAUDE.md §7). `units.type` covers `area` because the data
// shape anticipates one and the schema should not need a migration if it ever arrives — but this
// screen offers `stake` and `ward` only, and that is deliberate rather than unfinished. A screen
// for a level nobody has is a screen nobody can check.
//
// No permission is re-derived here. `canManage` is resolved once on the server and passed down; a
// client component has no unit assignments to read and a second answer that disagreed with the
// route's would be a UI offering a control the API refuses (`youth-a-D1`'s mirror).

export type WardSummary = {
  id: string;
  name: string;
  unitId: string | null;
};

export type StakesAndWardsProps = {
  initialUnits: Unit[];
  wards: WardSummary[];
  canManage: boolean;
};

type Draft = { type: UnitType; name: string; unitNumber: string; parentId: string };

const EMPTY_DRAFT: Draft = { type: "stake", name: "", unitNumber: "", parentId: "" };

export function StakesAndWards({ initialUnits, wards, canManage }: StakesAndWardsProps) {
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [editDraft, setEditDraft] = useState<{ name: string; unitNumber: string }>({
    name: "",
    unitNumber: "",
  });

  const stakes = units.filter((unit) => unit.type === "stake");
  const wardUnits = units.filter((unit) => unit.type === "ward");

  const wardsForUnit = (unitId: string): WardSummary[] =>
    wards.filter((ward) => ward.unitId === unitId);

  async function send(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<{ unit?: Unit } | null> {
    setIsSaving(true);
    setErrorMessage(undefined);

    try {
      const response = await fetch(path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        unit?: Unit;
        error?: string;
      };

      if (!response.ok) {
        // The server's sentence, not a generic one. A unit number already taken and a stake that
        // still has wards under it are different problems with different answers, and
        // lib/units/writeUnit.ts already wrote both for a person to read.
        throw new Error(payload.error ?? "Could not save that. Please try again.");
      }

      return payload;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save that. Please try again.",
      );
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  const handleCreate = async (): Promise<void> => {
    const payload = await send("/api/units", "POST", {
      type: draft.type,
      name: draft.name,
      unitNumber: draft.unitNumber === "" ? null : draft.unitNumber,
      parentId: draft.parentId === "" ? null : draft.parentId,
    });

    if (payload?.unit) {
      setUnits((current) => [...current, payload.unit as Unit]);
      setDraft(EMPTY_DRAFT);
    }
  };

  const handleSaveEdit = async (unitId: string): Promise<void> => {
    const payload = await send(`/api/units/${unitId}`, "PATCH", {
      name: editDraft.name,
      unitNumber: editDraft.unitNumber === "" ? null : editDraft.unitNumber,
    });

    if (payload?.unit) {
      setUnits((current) =>
        current.map((unit) => (unit.id === unitId ? (payload.unit as Unit) : unit)),
      );
      setEditing(undefined);
    }
  };

  const handleDelete = async (unit: Unit): Promise<void> => {
    // A plain confirm, and the refusal that matters is the SERVER'S: a stake with wards under it
    // fails on `on delete restrict` and comes back as a sentence naming what to do first. A
    // dialog that can be clicked through is not protection (ITER-031), so the guarantee lives in
    // the constraint rather than here.
    if (!window.confirm(`Remove ${unit.name}? This cannot be undone.`)) return;

    const payload = await send(`/api/units/${unit.id}`, "DELETE");
    if (payload) setUnits((current) => current.filter((entry) => entry.id !== unit.id));
  };

  function renderUnit(unit: Unit) {
    const attached = wardsForUnit(unit.id);

    return (
      <Card key={unit.id}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-foreground">{unit.name}</span>
          <Pill tone="neutral">
            {unit.type === "stake" ? "Stake" : "Ward"}
          </Pill>
          {/* A unit number that has not been recorded says so rather than rendering an empty
              space. It is the real church-assigned number and "not known yet" is a legitimate,
              ordinary state (migration 065a). */}
          <span className="text-sm text-muted">
            {unit.unitNumber ? `Unit ${unit.unitNumber}` : "No unit number yet"}
          </span>
        </div>

        {unit.type === "stake" && (
          <p className="mt-2 text-sm text-muted">
            {attached.length === 0
              ? "No wards under this stake yet."
              : `${attached.length} ${attached.length === 1 ? "ward" : "wards"}: ${attached
                  .map((ward) => ward.name)
                  .join(", ")}`}
          </p>
        )}

        {canManage && editing === unit.id && (
          <div className="mt-3 flex flex-col gap-2">
            <Input
              id={`unit-name-${unit.id}`}
              label="Name"
              value={editDraft.name}
              onChange={(event) =>
                setEditDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <Input
              id={`unit-number-${unit.id}`}
              label="Unit number"
              value={editDraft.unitNumber}
              placeholder="Leave empty until you know it"
              onChange={(event) =>
                setEditDraft((current) => ({ ...current, unitNumber: event.target.value }))
              }
            />
            <div className="flex gap-2">
              <Button onClick={() => void handleSaveEdit(unit.id)} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(undefined)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {canManage && editing !== unit.id && (
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(unit.id);
                setEditDraft({ name: unit.name, unitNumber: unit.unitNumber ?? "" });
              }}
            >
              Edit
            </Button>
            <Button variant="secondary" onClick={() => void handleDelete(unit)}>
              Remove
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError message={errorMessage} />

      {units.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            No units yet. Create a stake first, then add the wards under it.
          </p>
        </Card>
      )}

      {stakes.map(renderUnit)}

      {/* Ward units with no stake above them. Every ward created before this screen existed has
          none — `wards.unit_id` is nullable and stays that way (migration 065c) — so this is an
          ordinary state and is shown plainly rather than as a problem. */}
      {wardUnits.filter((unit) => unit.parentId === null).length > 0 && (
        <>
          <h2 className="mt-2 text-lg font-semibold text-foreground">
            Not under a stake yet
          </h2>
          {wardUnits.filter((unit) => unit.parentId === null).map(renderUnit)}
        </>
      )}

      {canManage && (
        <Card>
          <h2 className="text-base font-semibold text-foreground">Add a unit</h2>

          <div className="mt-3 flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Type</span>
              <select
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={draft.type}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    type: event.target.value as UnitType,
                  }))
                }
              >
                <option value="stake">Stake</option>
                <option value="ward">Ward</option>
              </select>
            </label>

            {draft.type === "ward" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">Under which stake</span>
                <select
                  className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={draft.parentId}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, parentId: event.target.value }))
                  }
                >
                  <option value="">Not under a stake</option>
                  {stakes.map((stake) => (
                    <option key={stake.id} value={stake.id}>
                      {stake.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <Input
              id="new-unit-name"
              label="Name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />

            <Input
              id="new-unit-number"
              label="Unit number"
              value={draft.unitNumber}
              placeholder="Leave empty until you know it"
              onChange={(event) =>
                setDraft((current) => ({ ...current, unitNumber: event.target.value }))
              }
            />

            <div>
              <Button onClick={() => void handleCreate()} disabled={isSaving}>
                {isSaving ? "Saving…" : "Add it"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
