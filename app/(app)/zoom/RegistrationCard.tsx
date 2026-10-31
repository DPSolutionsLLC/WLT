import { Card } from "@/components/ui/Card";
import type { RegistrationRow } from "@/lib/zoom/registrationRow";

// ONE SIGN-UP ON ZOOM → SIGN-UPS (ITER-052). The readers are the ward's leaders, so the phone, the
// email and the answers are shown; the status token and any private decline note never reach this
// page. The bishopric's buttons (approve, talk first, decline, match) arrive with slice z3b.

export function RegistrationCard({ row }: { row: RegistrationRow }) {
  return (
    <Card className="flex flex-col gap-1 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{row.displayName}</span>
        <span className={`text-xs ${row.isWaiting ? "text-warning" : "text-muted"}`}>{row.statusLine}</span>
      </div>
      <span className="text-xs text-muted">{row.memberLine}</span>
      <span className="break-words text-xs text-muted">
        {row.phone}
        {row.email ? ` · ${row.email}` : ""}
      </span>
      {row.answerLines.map((line, index) => (
        <span key={index} className="break-words text-xs text-foreground">
          {line}
        </span>
      ))}
      {row.referrerLine ? <span className="text-xs text-muted">{row.referrerLine}</span> : null}
      {row.flagLines.map((line) => (
        <span key={line} className="text-xs text-warning">
          {line}
        </span>
      ))}
      <span className="text-xs text-muted">{row.stamp}</span>
    </Card>
  );
}
