// A placeholder on purpose. The unread count, the feed, and the Realtime subscription all
// arrive in Phase 11 (plans/11-notifications-admin.md). Do not add a query or a subscription
// here — the shell renders on every authenticated page, so anything added here runs everywhere.
export function NotificationBell() {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 items-center justify-center text-lg text-muted"
    >
      🔔
    </span>
  );
}
