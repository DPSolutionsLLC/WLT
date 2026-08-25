import type { Metadata } from "next";
import type { ReactNode } from "react";

// The unauthenticated shell. It is defined by what it does NOT contain.
//
// No Sidebar, no TopNav, no NotificationBell, no ThemeToggle, no QueryProvider, no sign-in prompt
// and no link into the app. Two reasons, and both matter:
//
// 1. WEIGHT. This page is opened from a QR code, in a chapel, on a phone, on a connection shared
//    by two hundred people at once. Everything the app shell would pull down is JavaScript nobody
//    on this page can use.
//
// 2. SURFACE. Every piece of app chrome is a component that reads a session and knows a ward. A
//    public page that renders none of them cannot be one refactor away from rendering one that
//    reads something it should not.
//
// The dark-mode class still works: app/layout.tsx sets it on <html> from a constant inline script
// with no session and no network, so both themes render here without this shell doing anything.
//
// There is deliberately no "Sign in" link. A visitor scanning a QR code has no account, and a
// leader who does will not reach the app through the congregation's page.

export const metadata: Metadata = {
  // Static, so no query runs to build it and no ward data reaches a <head> nobody reviewed. The
  // page's own heading carries the ward name and the date.
  title: "Sacrament Meeting",
  description: "The program for this week's sacrament meeting.",

  // ---------------------------------------------------------------------------------------------
  // NOINDEX. THIS IS LOAD-BEARING, NOT BOILERPLATE.
  // ---------------------------------------------------------------------------------------------
  // The programme names everybody taking part IN FULL (a product decision on 2026-08-24 — see
  // lib/program/publicProjection.ts). "Anyone holding the link can read it" and "a ward roster of
  // full names is gathered into a search index and kept there" are very different promises, and
  // only the first one was intended.
  //
  // A QR code in a chapel and a link somebody shares both still work exactly as before: this asks
  // crawlers not to index, it does not restrict access, and it is not a security control. The
  // access rules are the view and the projection.
  //
  // Removing this line republishes the ward's names to search. Do not remove it casually.
  robots: { index: false, follow: false },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
      {children}
    </div>
  );
}
