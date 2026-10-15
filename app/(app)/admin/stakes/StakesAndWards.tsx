"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import {
  RELEASED_MODULES,
  releasedModuleLabel,
  type ReleasedModuleKey,
} from "@/lib/access/releasedModules";
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
  // The ward's released-modules list (migration 091). NULL MEANS EVERYTHING — the ward has none.
  releasedModules: ReleasedModuleKey[] | null;
};

type ReleaseDraft = { everything: boolean; modules: ReleasedModuleKey[] };

export type StakesAndWardsProps = {
  initialUnits: Unit[];
  wards: WardSummary[];
  canManage: boolean;
};

type CallingRole = "bishop" | "counselor";

type Draft = {
  type: UnitType;
  name: string;
  unitNumber: string;
  parentId: string;
  giveMeACalling: boolean;
  callingRole: CallingRole;
};

const EMPTY_DRAFT: Draft = {
  type: "stake",
  name: "",
  unitNumber: "",
  parentId: "",
  giveMeACalling: true,
  callingRole: "bishop",
};

type SavedPayload = { unit?: Unit; ward?: WardSummary | null; callingCreated?: boolean };

// WHERE A MESSAGE APPEARS. A message from the Add form shows inside the Add form, because that is
// where the person is looking: the walk of scenario 090 found the "was created" sentence 6,564px
// above the button that caused it. Edits and removals happen on a card, near the top.
type MessagePlace = "top" | "add";

const CATALOG_ORDER = new Map(RELEASED_MODULES.map((entry, index) => [entry.key, index]));

// One fixed order however the boxes were ticked, so a ward's list reads the same every time.
function inCatalogOrder(modules: readonly ReleasedModuleKey[]): ReleasedModuleKey[] {
  return [...modules].sort((a, b) => (CATALOG_ORDER.get(a) ?? 0) - (CATALOG_ORDER.get(b) ?? 0));
}

export function StakesAndWards({
  initialUnits,
  wards: initialWards,
  canManage,
}: StakesAndWardsProps) {
  const router = useRouter();
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [wards, setWards] = useState<WardSummary[]>(initialWards);
  const [notice, setNotice] = useState<string>();
  const [editingRelease, setEditingRelease] = useState<string>();
  const [releaseDraft, setReleaseDraft] = useState<ReleaseDraft>({
    everything: true,
    modules: [],
  });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [messagePlace, setMessagePlace] = useState<MessagePlace>("top");
  const [editing, setEditing] = useState<string>();
  const [editDraft, setEditDraft] = useState<{
    name: string;
    unitNumber: string;
    parentId: string;
  }>({
    name: "",
    unitNumber: "",
    parentId: "",
  });

  const stakes = units.filter((unit) => unit.type === "stake");
  const wardUnits = units.filter((unit) => unit.type === "ward");

  const wardsForUnit = (unitId: string): WardSummary[] =>
    wards.filter((ward) => ward.unitId === unitId);

  // A ward sits under a stake through its own unit's parent. A ward unit whose parent is not a
  // stake on this screen is listed with the unplaced ones rather than vanishing from the page.
  const wardUnitsUnder = (stakeId: string): Unit[] =>
    wardUnits.filter((unit) => unit.parentId === stakeId);
  const unplacedWardUnits = wardUnits.filter(
    (unit) => unit.parentId === null || !stakes.some((stake) => stake.id === unit.parentId),
  );

  async function send(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    place: MessagePlace,
    body?: unknown,
  ): Promise<SavedPayload | null> {
    setIsSaving(true);
    setErrorMessage(undefined);
    setNotice(undefined);
    setMessagePlace(place);

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

      const payload = (await response.json().catch(() => ({}))) as SavedPayload & {
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
    // The calling travels only for a ward, and only when ticked. A stake has no ward to hold one
    // in, and the server refuses it there with a sentence.
    const asksForCalling = draft.type === "ward" && draft.giveMeACalling;

    const payload = await send("/api/units", "POST", "add", {
      type: draft.type,
      name: draft.name,
      unitNumber: draft.unitNumber === "" ? null : draft.unitNumber,
      parentId: draft.parentId === "" ? null : draft.parentId,
      ...(asksForCalling ? { callingRole: draft.callingRole } : {}),
    });

    if (payload?.unit) {
      const created = payload.unit;
      setUnits((current) => [...current, created]);
      if (payload.ward) {
        const ward = payload.ward;
        setWards((current) => [...current, ward]);
      }
      setDraft(EMPTY_DRAFT);

      // The switcher lives in the chrome bar, which the server renders. Refreshing is what makes
      // it appear the moment the person holds callings in two wards.
      if (payload.callingCreated) {
        setNotice(`${created.name} was created. Switch to it from your account menu.`);
        router.refresh();
      } else if (payload.ward) {
        setNotice(`${created.name} was created.`);
      }
    }
  };

  // A ward's parent travels with the edit; a stake's never does, because nothing sits above a
  // stake on this screen and sending null would detach one that a script had placed under a unit.
  const handleSaveEdit = async (unit: Unit): Promise<void> => {
    const payload = await send(`/api/units/${unit.id}`, "PATCH", "top", {
      name: editDraft.name,
      unitNumber: editDraft.unitNumber === "" ? null : editDraft.unitNumber,
      ...(unit.type === "ward"
        ? { parentId: editDraft.parentId === "" ? null : editDraft.parentId }
        : {}),
    });

    if (payload?.unit) {
      const saved = payload.unit;
      setUnits((current) => current.map((entry) => (entry.id === unit.id ? saved : entry)));
      // The server renamed the ward behind a ward unit too (lib/units/writeUnit.ts).
      if (saved.type === "ward") {
        setWards((current) =>
          current.map((ward) => (ward.unitId === saved.id ? { ...ward, name: saved.name } : ward)),
        );
        router.refresh();
      }
      setEditing(undefined);
    }
  };

  // ONE PUT, the whole list. "Everything" sends null, which removes the ward's list rather than
  // writing every key — so a module added to the app later reaches a ward that never narrowed.
  const handleSaveRelease = async (ward: WardSummary): Promise<void> => {
    const modules = releaseDraft.everything ? null : inCatalogOrder(releaseDraft.modules);

    setIsSaving(true);
    setErrorMessage(undefined);
    setNotice(undefined);
    setMessagePlace("top");

    try {
      const response = await fetch(`/api/wards/${ward.id}/released-modules`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modules }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save the released modules. Please try again.");
      }

      setWards((current) =>
        current.map((entry) =>
          entry.id === ward.id ? { ...entry, releasedModules: modules } : entry,
        ),
      );
      setEditingRelease(undefined);
      // The chrome bar's "Admin view" pill and the dashboard read the session, which the server
      // renders, so the change is visible in the ward being acted in only after a refresh.
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not save the released modules. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  function toggleReleaseModule(key: ReleasedModuleKey, checked: boolean) {
    setReleaseDraft((current) => ({
      ...current,
      modules: checked
        ? [...current.modules, key]
        : current.modules.filter((entry) => entry !== key),
    }));
  }

  function renderReleaseEditor(ward: WardSummary) {
    if (editingRelease !== ward.id) {
      return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">
            {ward.releasedModules === null
              ? "Released: Everything"
              : ward.releasedModules.length === 0
                ? "Released: Nothing"
                : `Released: ${inCatalogOrder(ward.releasedModules).map(releasedModuleLabel).join(", ")}`}
          </span>
          {canManage && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditingRelease(ward.id);
                setReleaseDraft({
                  everything: ward.releasedModules === null,
                  modules: ward.releasedModules ?? [],
                });
              }}
            >
              Edit released modules
            </Button>
          )}
        </div>
      );
    }

    return (
      <fieldset className="mt-3 flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">
          Released modules for {ward.name}
        </legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={releaseDraft.everything}
            onChange={(event) =>
              setReleaseDraft((current) => ({ ...current, everything: event.target.checked }))
            }
          />
          Everything (no list)
        </label>
        {!releaseDraft.everything && (
          <div className="flex flex-col gap-1 pl-6">
            {RELEASED_MODULES.map((module) => (
              <label key={module.key} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={releaseDraft.modules.includes(module.key)}
                  onChange={(event) => toggleReleaseModule(module.key, event.target.checked)}
                />
                {module.label}
                {!module.built && <Pill tone="neutral">Not built yet</Pill>}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void handleSaveRelease(ward)} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={() => setEditingRelease(undefined)}>
            Cancel
          </Button>
        </div>
      </fieldset>
    );
  }

  function renderMessages() {
    return (
      <>
        <FormError message={errorMessage} />
        {notice && (
          <p role="status" className="text-sm text-foreground">
            {notice}
          </p>
        )}
      </>
    );
  }

  const handleDelete = async (unit: Unit): Promise<void> => {
    // A plain confirm, and the refusal that matters is the SERVER'S: a stake with wards under it
    // fails on `on delete restrict` and comes back as a sentence naming what to do first. A
    // dialog that can be clicked through is not protection (ITER-031), so the guarantee lives in
    // the constraint rather than here.
    if (!window.confirm(`Remove ${unit.name}? This cannot be undone.`)) return;

    const payload = await send(`/api/units/${unit.id}`, "DELETE", "top");
    if (payload) setUnits((current) => current.filter((entry) => entry.id !== unit.id));
  };

  function renderUnit(unit: Unit) {
    const attached = [
      ...new Set([
        ...wardUnitsUnder(unit.id).map((child) => child.name),
        ...wardsForUnit(unit.id).map((ward) => ward.name),
      ]),
    ];

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

        {/* A ward unit made before ITER-041 slice a has no ward behind it, and nothing can be
            done in it. Shown so it is not mistaken for a working ward; there is no repair. */}
        {unit.type === "ward" && wardsForUnit(unit.id).length === 0 && (
          <p className="mt-2 text-sm text-muted">No ward set up behind this unit.</p>
        )}

        {unit.type === "ward" &&
          wardsForUnit(unit.id).map((ward) => (
            <div key={ward.id}>{renderReleaseEditor(ward)}</div>
          ))}

        {unit.type === "stake" && (
          <p className="mt-2 text-sm text-muted">
            {attached.length === 0
              ? "No wards under this stake yet."
              : `${attached.length} ${attached.length === 1 ? "ward" : "wards"}: ${attached.join(
                  ", ",
                )}`}
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
            {unit.type === "ward" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">Under which stake</span>
                <select
                  id={`unit-parent-${unit.id}`}
                  className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={editDraft.parentId}
                  onChange={(event) =>
                    setEditDraft((current) => ({ ...current, parentId: event.target.value }))
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
            <div className="flex gap-2">
              <Button onClick={() => void handleSaveEdit(unit)} disabled={isSaving}>
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
                setEditDraft({
                  name: unit.name,
                  unitNumber: unit.unitNumber ?? "",
                  parentId: unit.parentId ?? "",
                });
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
      {messagePlace === "top" && renderMessages()}

      {units.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            No units yet. Create a stake first, then add the wards under it.
          </p>
        </Card>
      )}

      {stakes.map((stake) => {
        const children = wardUnitsUnder(stake.id);
        return (
          <div key={stake.id} className="flex flex-col gap-2">
            {renderUnit(stake)}
            {children.length > 0 && (
              <div className="ml-4 flex flex-col gap-2 border-l border-border pl-3">
                {children.map(renderUnit)}
              </div>
            )}
          </div>
        );
      })}

      {/* Ward units with no stake above them. Every ward created before this screen existed has
          none — `wards.unit_id` is nullable and stays that way (migration 065c) — so this is an
          ordinary state and is shown plainly rather than as a problem. */}
      {unplacedWardUnits.length > 0 && (
        <>
          <h2 className="mt-2 text-lg font-semibold text-foreground">
            Not under a stake yet
          </h2>
          {unplacedWardUnits.map(renderUnit)}
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

            {draft.type === "ward" && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.giveMeACalling}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        giveMeACalling: event.target.checked,
                      }))
                    }
                  />
                  Give me a calling here
                </label>
                {draft.giveMeACalling && (
                  <select
                    aria-label="Calling"
                    className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={draft.callingRole}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        callingRole: event.target.value as CallingRole,
                      }))
                    }
                  >
                    <option value="bishop">Bishop</option>
                    <option value="counselor">Counselor</option>
                  </select>
                )}
              </div>
            )}

            <div>
              <Button onClick={() => void handleCreate()} disabled={isSaving}>
                {isSaving ? "Saving…" : "Add it"}
              </Button>
            </div>

            {messagePlace === "add" && renderMessages()}
          </div>
        </Card>
      )}
    </div>
  );
}
