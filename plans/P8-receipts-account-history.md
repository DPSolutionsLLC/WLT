# P8 — Receipts · Account · Speaking History Admin

**Depends on:** P3. **Size:** Medium. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** [prototype/module-map.md](prototype/module-map.md), and build-notes-raw.md §`receipts`, §`account-page`, §`speaking-history-admin`.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

Three independent modules grouped because each is small.

## Receipts

Lean two-actor flow: `submitted` → `entered` → `reconciled`. **No reimbursement tracking, no
budget math** — intake and audit trail only, never a replacement for LCR.

Reconciliation sessions where `completedAt` is bookkeeping only, **never a gate** — a receipt
reconciles the moment it is checked off.

**The join link** — a `joinToken` giving a helper access to one session and nothing else,
swapping the whole app shell for a stripped-down view. The sixth use of the unauthenticated
single-purpose token pattern; reuse it rather than inventing a seventh.

AI extraction from a photo is real here (WLT has an Anthropic key) — but it is a **draft the
submitter reviews and corrects**, never auto-saved. CLAUDE.md rule 3.

## Account

Profile photo and email, both real. Password needs the auth system — WLT **has** one, so unlike
the prototype this can be genuinely built.

## Speaking History Admin

Bulk backfill into the **same** `speaker_history` rows the per-Sunday assignment already syncs
into — never a second, parallel history.

**The design decision worth preserving:** a manually-entered row carries no source date/index,
and that absence is what keeps it safe — the auto-sync only ever touches rows matching a real
slot, so a manual entry can never be silently overwritten and a synced entry can never be
orphaned. Consequence, also deliberate: synced entries show here **read-only**.

CSV / TSV / XLSX / paste all feed one pipeline — format detection at the top, then one shared
column-mapping and reconciliation path. Name matching is **deterministic token overlap,
explicitly not AI**, with confidence shown as exact/likely/no-match.

> ⚠️ **XLSX is a new dependency** (`xlsx` / SheetJS) and a sizeable one. CLAUDE.md §7 says do not
> install dependencies without asking. **Ask first**, and consider whether TSV-paste covers the
> real need — copying cells out of a spreadsheet always produces tab-separated text.
