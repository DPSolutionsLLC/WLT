"use client";

import styles from "@/app/(tithing)/tithing/tithing.module.css";
import type { Denomination, DenominationInputs } from "@/lib/tithing/denominations";
import { formatDollars, normalizeQuantityInput, quantityValue } from "@/lib/tithing/money";

export type DenominationRowsProps = {
  denominations: readonly Denomination[];
  inputs: DenominationInputs;
  onChange: (inputs: DenominationInputs) => void;
};

// One row per denomination: name, a quantity box, and the dollar value of that quantity computed
// beside it as you type. The inline value is what makes the row checkable — "7" means nothing
// while counting, "$140.00" can be compared against the stack in hand.
export function DenominationRows({ denominations, inputs, onChange }: DenominationRowsProps) {
  return (
    <div>
      {denominations.map((denomination) => {
        const input = inputs[denomination.id] ?? "";
        const valueCents = quantityValue(input) * denomination.cents;

        return (
          <div key={denomination.id} className={styles.denomRow}>
            <div className={styles.denomName}>
              {denomination.label}
              <span className={styles.denomSub}>{denomination.sublabel}</span>
            </div>

            <input
              className={styles.denomQty}
              type="text"
              inputMode="numeric"
              placeholder="0"
              aria-label={`${denomination.label} quantity`}
              value={input}
              onChange={(event) =>
                onChange({
                  ...inputs,
                  [denomination.id]: normalizeQuantityInput(event.target.value),
                })
              }
            />

            <div className={styles.denomVal}>{formatDollars(valueCents)}</div>
          </div>
        );
      })}
    </div>
  );
}
