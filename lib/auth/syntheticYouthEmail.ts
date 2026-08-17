// A leaf module with no imports, on purpose. The harness seed factories need this exact
// format, and they run under Node's --experimental-strip-types, which resolves neither the
// `@/` path alias nor anything those aliased modules pull in. Importing it from
// lib/auth/youthAccounts.ts there would fail at run time, and a second copy of the format in
// testing/ would drift — the drift showing up as a youth login that fails for no visible
// reason. lib/auth/youthAccounts.ts re-exports this so app code has one obvious place to
// import it from.

// A youth account has no inbox. RFC 2606 reserves .invalid, so this address can never resolve
// and no mail can ever be sent to it — which is what makes it safe as the identifier on a
// synthetic Supabase Auth account.
//
// The ward id rather than a slug: `wards` has no slug column, and adding one to prevent a
// collision a UUID already prevents is the wrong trade. This deviates from
// plans/01-auth-rbac.md §Step 4 deliberately.
export function syntheticYouthEmail(username: string, wardId: string): string {
  return `${username.toLowerCase()}@youth.${wardId}.invalid`;
}
