# P13 — Accessibility & Theme Polish

**Depends on:** all. **Size:** Small. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** the retired [12-polish-multiward.md](12-polish-multiward.md) — its multi-ward half became P2.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

The last phase before a second ward is onboarded for real. Nothing new; everything sharper.

- **Accessibility pass** — keyboard paths, focus order, landmarks, screen-reader labels on every
  icon-only control. The chrome bar from P3 is icon-dense and is the first place to check.
- **Contrast re-measurement** across both themes once every module is on the P1 tokens. P1
  measured the tokens; this measures them **in situ**, which is where the stage colours were
  found needing a retune.
- **375px sweep** of every screen shipped since P1.
- **Empty and error states** — the prototype is full of honest ones worth copying.
- **The dead-link class of bug.** P3 gates tiles on built-AND-permitted; re-verify nothing has
  regressed, including the `(youth)` and `(tithing)` shells.
- **Onboarding a second ward end to end** as the real test of P2.
