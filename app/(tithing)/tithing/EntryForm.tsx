"use client";

import styles from "@/app/(tithing)/tithing/tithing.module.css";
import { CheckRows, type DraftCheck } from "@/app/(tithing)/tithing/CheckRows";
import { DenominationRows } from "@/app/(tithing)/tithing/DenominationRows";
import { BILLS, COINS, type DenominationInputs } from "@/lib/tithing/denominations";
import { formatDollars } from "@/lib/tithing/money";
import type { EntryTotals } from "@/lib/tithing/totals";

export type EntryFormProps = {
  badgeLabel: string;
  saveLabel: string;
  checks: DraftCheck[];
  quantities: DenominationInputs;
  totals: EntryTotals;
  onChecksChange: (checks: DraftCheck[]) => void;
  onAddCheck: () => void;
  onQuantitiesChange: (quantities: DenominationInputs) => void;
  onSave: () => void;
  onClear: () => void;
};

// The envelope currently being counted. It holds no state of its own — every keystroke goes up
// to TithingCounter, which is the only place a session exists.
export function EntryForm({
  badgeLabel,
  saveLabel,
  checks,
  quantities,
  totals,
  onChecksChange,
  onAddCheck,
  onQuantitiesChange,
  onSave,
  onClear,
}: EntryFormProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHdr}>
        Current Entry
        <span className={styles.badge}>{badgeLabel}</span>
      </div>

      <div className={styles.cardBody}>
        <div className={styles.slbl}>Checks</div>
        <CheckRows checks={checks} onChange={onChecksChange} onAdd={onAddCheck} />

        <div className={styles.slbl}>Cash</div>
        <DenominationRows
          denominations={BILLS}
          inputs={quantities}
          onChange={onQuantitiesChange}
        />

        <div className={styles.slbl}>Coins</div>
        <DenominationRows
          denominations={COINS}
          inputs={quantities}
          onChange={onQuantitiesChange}
        />

        {/* Live on every keystroke, and never behind a "calculate" button. The person reading
            this is holding the cash it describes. */}
        <div className={styles.totalsStrip}>
          <div className={styles.totItem}>
            <div className={styles.tl}>Checks</div>
            <div className={styles.tv}>{formatDollars(totals.checksCents)}</div>
          </div>
          <div className={styles.totItem}>
            <div className={styles.tl}>Cash</div>
            <div className={styles.tv}>{formatDollars(totals.billsCents)}</div>
          </div>
          <div className={styles.totItem}>
            <div className={styles.tl}>Coins</div>
            <div className={styles.tv}>{formatDollars(totals.coinsCents)}</div>
          </div>
        </div>

        <div className={styles.grandBox}>
          <span className={styles.gl}>Grand Total</span>
          <span className={styles.gv}>{formatDollars(totals.grandCents)}</span>
        </div>

        <div className={styles.actionRow}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onSave}
          >
            {saveLabel}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
