"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { addMonths, monthLabel, type DateOnly } from "@/lib/calendar/dates";

export type MonthNavigationProps = {
  monthStart: DateOnly;
  // The month containing today, resolved on the SERVER and passed in. A client component that
  // called new Date() here would disagree with the page behind it for anyone whose local date and
  // UTC date differ — which is half of every evening in the Americas.
  currentMonthStart: DateOnly;
  // Which month page the arrows drive. The calendar and the assignment planner are the same
  // control over the same months, so they share the component rather than each growing their
  // own pair of buttons — the only thing that differs is where ?month= lands.
  basePath?: string;
};

export function MonthNavigation({
  monthStart,
  currentMonthStart,
  basePath = "/calendar",
}: MonthNavigationProps) {
  const router = useRouter();

  // addMonths, never new Date(year, month + 1). The native form is a local-time write and rolls
  // over wrong at a year boundary in some zones (lib/calendar/dates.ts).
  function goTo(target: DateOnly): void {
    router.push(`${basePath}?month=${target.slice(0, 7)}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={() => goTo(addMonths(monthStart, -1))}
        aria-label={`Go to ${monthLabel(addMonths(monthStart, -1))}`}
      >
        Previous
      </Button>

      <Button
        type="button"
        variant="secondary"
        onClick={() => goTo(currentMonthStart)}
      >
        Today
      </Button>

      <Button
        type="button"
        variant="secondary"
        onClick={() => goTo(addMonths(monthStart, 1))}
        aria-label={`Go to ${monthLabel(addMonths(monthStart, 1))}`}
      >
        Next
      </Button>
    </div>
  );
}
