"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/(tithing)/tithing/tithing.module.css";
import { digitsToCents, formatCents } from "@/lib/tithing/money";

// A check being typed. The amount is `null` until somebody touches the field, which is NOT the
// same as zero: an untouched box shows its placeholder, and a box that has been typed into and
// then emptied shows "0.00". A plain number cannot tell those two apart, and the difference is
// visible on screen thirteen rows at a time.
export type DraftCheck = {
  id: string;
  number: string;
  amountCents: number | null;
};

// The fixed-decimal amount field.
//
// Every digit shifts the value one place right of the decimal: 2 -> 0.02, 236 -> 2.36,
// 23600 -> 236.00. There is no decimal key to press, which is the whole point on a phone keypad
// held over a table of cash — the field cannot end up holding "23.6" that might mean $23.60 or
// $2.36, and there is no way to put the point in the wrong place.
//
// type="text" with inputMode="numeric", not type="number": a number input accepts "-", "e" and
// "1.2.3" from a hardware keyboard and reports them as the empty string, so a typed amount could
// silently become nothing. Text plus a digits-only parse cannot.
function CheckAmountInput({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (amountCents: number) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const display = value === null ? "" : formatCents(value);

  // The caret goes to the end after every keystroke. Re-rendering a controlled input with a
  // reformatted value ("23.60" becoming "236.00") leaves the browser caret at the offset it had
  // before, which is now the middle of the number — so the next digit would land in the wrong
  // place. Only while the field is focused: moving the caret in a field nobody is typing into
  // would steal focus from the one they are.
  useEffect(() => {
    const input = inputRef.current;
    if (input === null || document.activeElement !== input) return;
    input.setSelectionRange(input.value.length, input.value.length);
  }, [display]);

  return (
    <input
      ref={inputRef}
      className={styles.textInput}
      type="text"
      inputMode="numeric"
      placeholder="0.00"
      aria-label={label}
      value={display}
      onChange={(event) => onChange(digitsToCents(event.target.value))}
      onFocus={(event) => event.target.select()}
    />
  );
}

export type CheckRowsProps = {
  checks: DraftCheck[];
  onChange: (checks: DraftCheck[]) => void;
  onAdd: () => void;
};

export function CheckRows({ checks, onChange, onAdd }: CheckRowsProps) {
  function update(id: string, changes: Partial<DraftCheck>) {
    onChange(checks.map((check) => (check.id === id ? { ...check, ...changes } : check)));
  }

  return (
    <>
      <div className={styles.checkHdrs}>
        <span>Check Number</span>
        <span>Amount ($)</span>
        <span />
      </div>

      <div className={styles.checkList}>
        {checks.map((check, index) => (
          <div key={check.id} className={styles.checkRow}>
            {/* inputMode="numeric" opens the number pad, but the field is text and accepts
                letters on purpose: real check numbers carry them ("1042A") and leading zeros. */}
            <input
              className={styles.textInput}
              type="text"
              inputMode="numeric"
              placeholder="Check #"
              aria-label={`Check ${index + 1} number`}
              value={check.number}
              onChange={(event) => update(check.id, { number: event.target.value })}
            />

            <CheckAmountInput
              label={`Check ${index + 1} amount`}
              value={check.amountCents}
              onChange={(amountCents) => update(check.id, { amountCents })}
            />

            <button
              type="button"
              className={styles.btnRemove}
              aria-label={`Remove check ${index + 1}`}
              title="Remove"
              onClick={() => onChange(checks.filter((row) => row.id !== check.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button type="button" className={styles.btnAddCheck} onClick={onAdd}>
        + Add Check
      </button>
    </>
  );
}
