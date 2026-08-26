"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "@/app/(tithing)/tithing/tithing.module.css";
import type { DraftCheck } from "@/app/(tithing)/tithing/CheckRows";
import { EntryForm } from "@/app/(tithing)/tithing/EntryForm";
import { SummaryPanel } from "@/app/(tithing)/tithing/SummaryPanel";
import {
  emptyDenominationInputs,
  toDenominationInputs,
  toQuantities,
  type DenominationInputs,
} from "@/lib/tithing/denominations";
import { entryTotals, type CheckAmount, type TithingEntry } from "@/lib/tithing/totals";

// The whole tithing session, and the only place it exists.
//
// ---------------------------------------------------------------------------------------------
// NOTHING HERE IS SAVED ANYWHERE. THAT IS THE DESIGN.
// ---------------------------------------------------------------------------------------------
// No database write, no localStorage, no sessionStorage, no server call — not one, in this whole
// module. A counting session lives in React state for as long as the tab is open and is gone the
// moment it is not.
//
// This is a DELIBERATE narrowing of plans/09-meetings-tithing.md §Step B2, which specified
// tithing_sessions and tithing_entries rows with sequential entry numbers and a midnight cron to
// delete them. Those tables exist (migration 011) with their RLS suite, and this module does not
// touch them. Two things follow, and the second is the one to keep in mind:
//
//   1. CLAUDE.md §4.11 says tithing data is a counting worksheet, not a record. Data that is
//      never written cannot be read by the wrong person, leaked by a query, or left behind by a
//      cron that did not run — and the ward-local-midnight problem the plan warns about stops
//      existing rather than being solved carefully.
//
//   2. A refresh, a phone going to sleep and reloading the tab, or a stray back-swipe destroys
//      an in-progress count with nothing to recover from. That is why leaving is guarded below,
//      and it is the reason this decision is worth revisiting if a real count is ever lost.
//
// If persistence is ever wanted, it belongs behind the plan's tables and RLS, NOT in browser
// storage — dollar amounts on a shared or borrowed phone is the worse of the two.
// ---------------------------------------------------------------------------------------------

const TOAST_DURATION_MS = 2400;

type Tab = "entry" | "summary";

function createCheck(id: string): DraftCheck {
  return { id, number: "", amountCents: null };
}

// Rows that hold neither a number nor an amount are dropped at save: an entry with three empty
// check rows submitted three checks of nothing, and the summary would list them.
function toSavedChecks(checks: DraftCheck[]): CheckAmount[] {
  return checks
    .map((check) => ({ number: check.number.trim(), amountCents: check.amountCents ?? 0 }))
    .filter((check) => check.number !== "" || check.amountCents > 0);
}

export function TithingCounter() {
  const [entries, setEntries] = useState<TithingEntry[]>([]);
  const [nextEntryNumber, setNextEntryNumber] = useState(1);

  // Which SAVED ENTRY is open for editing, keyed by its entry number rather than its position in
  // the array. An index goes stale the moment an earlier entry is deleted, and the update would
  // then silently overwrite the wrong envelope — a class of bug that simply cannot arise when the
  // key is the number printed on the paper slip.
  const [editingEntryNumber, setEditingEntryNumber] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>("entry");
  const [checks, setChecks] = useState<DraftCheck[]>(() => [createCheck("check-0")]);
  const [quantities, setQuantities] = useState<DenominationInputs>(emptyDenominationInputs);
  const [toast, setToast] = useState<string | null>(null);

  const checkIdCounter = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextCheckId = useCallback(() => {
    checkIdCounter.current += 1;
    return `check-${checkIdCounter.current}`;
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, []);

  const draftQuantities = useMemo(() => toQuantities(quantities), [quantities]);
  const draftTotals = useMemo(
    () => entryTotals({ checks: toSavedChecks(checks), quantities: draftQuantities }),
    [checks, draftQuantities],
  );

  // Saved entries are at risk too, not just the one being typed — they live in this component and
  // nowhere else, so leaving the page loses the entire count.
  const hasCountInProgress = entries.length > 0 || draftTotals.grandCents > 0;

  // The browser prompt on refresh, tab close and back-swipe. Registered only while there is
  // something to lose, so an empty screen closes without an argument.
  useEffect(() => {
    if (!hasCountInProgress) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Browsers show their own wording and ignore this string, but assigning it is still what
      // triggers the prompt in several of them.
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasCountInProgress]);

  const resetForm = useCallback(() => {
    setChecks([createCheck(nextCheckId())]);
    setQuantities(emptyDenominationInputs());
  }, [nextCheckId]);

  const cancelEdit = useCallback(() => {
    setEditingEntryNumber(null);
    resetForm();
  }, [resetForm]);

  function handleAddCheck() {
    setChecks((current) => [...current, createCheck(nextCheckId())]);
  }

  function handleSave() {
    const contents = { checks: toSavedChecks(checks), quantities: draftQuantities };

    if (draftTotals.grandCents === 0) {
      showToast("Nothing to save — enter amounts first");
      return;
    }

    if (editingEntryNumber !== null) {
      const updatedNumber = editingEntryNumber;
      setEntries((current) =>
        current.map((entry) =>
          entry.entryNumber === updatedNumber ? { ...contents, entryNumber: updatedNumber } : entry,
        ),
      );
      setEditingEntryNumber(null);
      resetForm();
      showToast(`Entry #${updatedNumber} updated ✓`);
      return;
    }

    // The number is claimed here and never reused. Deleting entry #4 leaves a gap, because the
    // slip in the tray still says 4 and renumbering would make the paper wrong.
    const savedNumber = nextEntryNumber;
    setEntries((current) => [...current, { ...contents, entryNumber: savedNumber }]);
    setNextEntryNumber(savedNumber + 1);
    resetForm();
    showToast(`Entry #${savedNumber} saved ✓`);
  }

  // Clear doubles as cancel while editing, so there is never a state where the gold banner is up
  // and the only way out is to save a change nobody wanted.
  function handleClear() {
    if (editingEntryNumber !== null) {
      cancelEdit();
      return;
    }
    resetForm();
    showToast("Entry cleared");
  }

  function handleEdit(entryNumber: number) {
    const entry = entries.find((candidate) => candidate.entryNumber === entryNumber);
    if (entry === undefined) return;

    setEditingEntryNumber(entryNumber);
    setChecks(
      entry.checks.length === 0
        ? [createCheck(nextCheckId())]
        : entry.checks.map((check) => ({
            id: nextCheckId(),
            number: check.number,
            amountCents: check.amountCents > 0 ? check.amountCents : null,
          })),
    );
    setQuantities(toDenominationInputs(entry.quantities));
    setActiveTab("entry");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleDelete(entryNumber: number) {
    if (editingEntryNumber === entryNumber) cancelEdit();
    setEntries((current) => current.filter((entry) => entry.entryNumber !== entryNumber));
    showToast(`Entry #${entryNumber} removed`);
  }

  function handleClearAll() {
    if (entries.length === 0) {
      showToast("Nothing to clear");
      return;
    }

    const noun = entries.length === 1 ? "entry" : "entries";
    const confirmed = window.confirm(
      `Clear all ${entries.length} saved ${noun}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setEntries([]);
    setNextEntryNumber(1);
    setEditingEntryNumber(null);
    resetForm();
    showToast("Session cleared");
  }

  function handleLeave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!hasCountInProgress) return;

    const confirmed = window.confirm(
      "Leaving ends this count. Nothing on this screen is saved anywhere, so the entries and totals will be gone. Leave anyway?",
    );
    if (!confirmed) event.preventDefault();
  }

  const entryCountLabel =
    entries.length === 1 ? "1 entry" : `${entries.length} entries`;
  const badgeLabel =
    editingEntryNumber === null ? `Entry #${nextEntryNumber}` : `Editing #${editingEntryNumber}`;
  const saveLabel = editingEntryNumber === null ? "Save Entry →" : "Update Entry ✓";

  return (
    <div className={styles.root}>
      <header className={styles.hdr}>
        <div className={styles.hdrLeft}>
          <Link href="/dashboard" className={styles.backLink} onClick={handleLeave}>
            <span aria-hidden="true">←</span> Dashboard
          </Link>
          <span className={styles.wlt}>WLT</span>
          <h1 className={styles.hdrTitle}>Tithing Counter</h1>
        </div>
        <span className={styles.hdrBadge}>{entryCountLabel}</span>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Tithing counter sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "entry"}
          className={`${styles.tab} ${activeTab === "entry" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("entry")}
        >
          Entry
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "summary"}
          className={`${styles.tab} ${activeTab === "summary" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("summary")}
        >
          Summary
        </button>
      </div>

      {editingEntryNumber !== null && (
        <div className={styles.editBanner}>
          Editing Entry #{editingEntryNumber} — Save to update
        </div>
      )}

      <div className={styles.page} role="tabpanel">
        {activeTab === "entry" ? (
          <EntryForm
            badgeLabel={badgeLabel}
            saveLabel={saveLabel}
            checks={checks}
            quantities={quantities}
            totals={draftTotals}
            onChecksChange={setChecks}
            onAddCheck={handleAddCheck}
            onQuantitiesChange={setQuantities}
            onSave={handleSave}
            onClear={handleClear}
          />
        ) : (
          <SummaryPanel
            entries={entries}
            editingEntryNumber={editingEntryNumber}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onClearAll={handleClearAll}
          />
        )}
      </div>

      {/* Always in the tree so the live region is announced when its text changes, rather than
          appearing and disappearing as an element screen readers have to rediscover. */}
      <div
        role="status"
        aria-live="polite"
        className={`${styles.toast} ${toast === null ? "" : styles.toastShow}`}
      >
        {toast ?? ""}
      </div>
    </div>
  );
}
