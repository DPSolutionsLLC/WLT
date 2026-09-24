import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Google Calendar — shown, and honestly unavailable.
//
// The prototype carries a "Connect Google Calendar" card. Connecting one needs Google OAuth and
// token refresh, which this app does not have and which plans/INDEX.md's guardrails keep out of
// scope. A button that pretends to work is worse than none, so this one is disabled and the
// sentence beside it says why and what to do instead.

export function CalendarSyncCard() {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-foreground">Google Calendar</h2>
      <p className="text-sm text-muted">
        Not available yet — connecting a calendar needs Google sign-in, which this app does not
        have. Your appointments are listed here in the meantime.
      </p>
      <div>
        <Button variant="secondary" disabled>
          Connect Google Calendar
        </Button>
      </div>
    </Card>
  );
}
