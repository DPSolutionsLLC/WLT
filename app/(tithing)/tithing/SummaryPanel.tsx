"use client";

import styles from "@/app/(tithing)/tithing/tithing.module.css";
import { BILLS, COINS, type Denomination } from "@/lib/tithing/denominations";
import { formatDollars } from "@/lib/tithing/money";
import {
  denominationTally,
  entryTotals,
  sessionTotals,
  submittedChecks,
  type TithingEntry,
} from "@/lib/tithing/totals";

export type SummaryPanelProps = {
  entries: TithingEntry[];
  editingEntryNumber: number | null;
  onEdit: (entryNumber: number) => void;
  onDelete: (entryNumber: number) => void;
  onClearAll: () => void;
};

// The verification half of the session: what the drawer should physically contain, so the second
// person can count against it (FEATURES.md §Module 13 — one person enters, a second verifies).
function DenominationSection({
  title,
  denominations,
  entries,
  emptyMessage,
}: {
  title: string;
  denominations: readonly Denomination[];
  entries: TithingEntry[];
  emptyMessage: string;
}) {
  const tally = denominationTally(entries, denominations);

  return (
    <div className={styles.denomSection}>
      <div className={styles.denomSectionHdr}>{title}</div>

      {tally.length === 0 ? (
        <div className={styles.denomEmpty}>{emptyMessage}</div>
      ) : (
        tally.map(({ denomination, quantity, valueCents }) => (
          <div key={denomination.id} className={styles.dsRow}>
            <span className={styles.dsName}>{denomination.label}</span>
            <span className={styles.dsFigures}>
              <span className={styles.dsQty}>
                {quantity} {denomination.unitLabel}
              </span>
              <span className={styles.dsVal}>{formatDollars(valueCents)}</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export function SummaryPanel({
  entries,
  editingEntryNumber,
  onEdit,
  onDelete,
  onClearAll,
}: SummaryPanelProps) {
  const totals = sessionTotals(entries);
  const checks = submittedChecks(entries);
  const checksTotalCents = checks.reduce((total, check) => total + check.amountCents, 0);

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardHdr}>Session Totals</div>
        <div className={styles.sumTotals}>
          <div>
            <div className={styles.sl}>Submissions</div>
            <div className={styles.sv}>{totals.entryCount}</div>
          </div>
          <div>
            <div className={styles.sl}>Checks</div>
            <div className={styles.sv}>{formatDollars(totals.checksCents)}</div>
          </div>
          <div>
            <div className={styles.sl}>Cash</div>
            <div className={styles.sv}>{formatDollars(totals.billsCents)}</div>
          </div>
          <div>
            <div className={styles.sl}>Coins</div>
            <div className={styles.sv}>{formatDollars(totals.coinsCents)}</div>
          </div>
          <div className={styles.sumGrand}>
            <span className={styles.sgl}>Grand Total</span>
            <span className={styles.sgv}>{formatDollars(totals.grandCents)}</span>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHdr}>Denomination Totals</div>
        <div className={styles.denomSummarySection}>
          <div className={styles.denomSummaryNote}>
            Total quantity of each denomination across all entries — for verification counting.
          </div>
          <DenominationSection
            title="Cash"
            denominations={BILLS}
            entries={entries}
            emptyMessage="No cash entered"
          />
          <DenominationSection
            title="Coins"
            denominations={COINS}
            entries={entries}
            emptyMessage="No coins entered"
          />
        </div>
      </div>

      {/* Hidden outright when nobody has submitted a check, rather than shown holding a zero.
          An empty bordered card on a counting screen reads as a section that failed to fill in
          (plans/retros/program-b-builder-screen.md). */}
      {checks.length > 0 && (
        <div className={styles.card}>
          <div className={styles.cardHdr}>Checks Submitted</div>
          <div className={styles.checkSummarySection}>
            {checks.map((check, index) => (
              <div
                key={`${check.entryNumber}-${index}`}
                className={styles.checkSummaryRow}
              >
                <div className={styles.checkSummaryLeft}>
                  <span className={styles.checkEntryTag}>Entry #{check.entryNumber}</span>
                  <span className={styles.checkNum}>
                    {check.number === "" ? "No check #" : `Ck #${check.number}`}
                  </span>
                </div>
                <span className={styles.checkAmt}>{formatDollars(check.amountCents)}</span>
              </div>
            ))}

            <div className={styles.checksTotalRow}>
              <span className={styles.ctl}>
                Check Total ({checks.length} {checks.length === 1 ? "check" : "checks"})
              </span>
              <span className={styles.ctv}>{formatDollars(checksTotalCents)}</span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardHdr}>Entries</div>

        <div className={styles.entryLog}>
          {entries.length === 0 ? (
            <div className={styles.logEmpty}>No entries yet</div>
          ) : (
            entries.map((entry) => {
              const entryTotal = entryTotals(entry);
              const isEditing = entry.entryNumber === editingEntryNumber;

              return (
                <div
                  key={entry.entryNumber}
                  className={`${styles.logItem} ${isEditing ? styles.logItemEditing : ""}`}
                >
                  <div className={styles.logTop}>
                    <span className={styles.logNum}>Entry #{entry.entryNumber}</span>
                    <span className={styles.logGrand}>
                      {formatDollars(entryTotal.grandCents)}
                    </span>
                  </div>

                  <div className={styles.logSubtotals}>
                    <div className={styles.logSubRow}>
                      <span className={styles.logSubLbl}>Checks</span>
                      <span className={styles.logSubVal}>
                        {formatDollars(entryTotal.checksCents)}
                      </span>
                    </div>
                    <div className={styles.logSubRow}>
                      <span className={styles.logSubLbl}>Cash</span>
                      <span className={styles.logSubVal}>
                        {formatDollars(entryTotal.billsCents)}
                      </span>
                    </div>
                    <div className={styles.logSubRow}>
                      <span className={styles.logSubLbl}>Coins</span>
                      <span className={styles.logSubVal}>
                        {formatDollars(entryTotal.coinsCents)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.logActions}>
                    <button
                      type="button"
                      className={`${styles.logBtn} ${styles.logBtnEdit}`}
                      onClick={() => onEdit(entry.entryNumber)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${styles.logBtn} ${styles.logBtnDel}`}
                      onClick={() => onDelete(entry.entryNumber)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.clearAllRow}>
          <button type="button" className={styles.btnDangerOutline} onClick={onClearAll}>
            Clear All Entries
          </button>
        </div>
      </div>
    </>
  );
}
