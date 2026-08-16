# Failure Report

**Date:**
**Tester:**
**Scenario:** `<scope>/<scenario-folder>`
**Branch:**
**Commit:**

---

## Failed Checks

Copy the checklist line that failed, verbatim.

### 1. <the checklist line>

**Expected:**
**Actual:**

**Steps to reproduce:**
1.
2.

---

## Console Errors

```
paste browser console and terminal output here
```

## Network / Supabase Errors

Status code, PostgREST error code, and message. A `42501` is a row-level security denial —
say which table and which role.

```
```

## Database State

What the relevant rows actually looked like. Query with the service-role key or the Supabase
dashboard, and say which ward id you were in.

```sql
-- e.g. select id, pipeline_stage from assignments where ward_id = '11111111-...';
```

## Screenshots

Attach or link. Include the viewport width — a lot of this app's rules are mobile-first, and
375px behaves differently from a desktop window.

---

## Diagnosis Notes

Where you think it broke and why. Leave blank if unsure; a clean reproduction is worth more
than a guess.

## Rule Check

Does the failure touch a non-negotiable in CLAUDE.md §4? Tick any that apply — these get
priority over feature bugs.

- [ ] Ward isolation (rule 1/2) — data from another ward was visible
- [ ] AI output reached a human or a row without approval (rule 3)
- [ ] A private note was visible to someone other than its author (rule 5)
- [ ] A mutation did not write an audit row (rule 6)
- [ ] An error was swallowed with no user-facing message (rule 7)
- [ ] A secret, PIN, or token appeared in a log or the UI (rule 8)
- [ ] Tithing data touched member data (rule 10)
