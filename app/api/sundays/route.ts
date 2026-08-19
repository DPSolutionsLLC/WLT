import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createSunday, generateSundayRange, listSundays } from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sundayPostSchema, sundayRangeSchema } from "@/lib/validation/calendar";

// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500
// (lib/auth/routeErrors.ts says so at the call site).

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "calendar.view");

    const searchParams = new URL(request.url).searchParams;
    const range = sundayRangeSchema.parse({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    });

    const supabase = await createServerSupabaseClient();
    const sundays = await listSundays(user.wardId, range, supabase);

    return NextResponse.json({ sundays });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/sundays",
      fallbackMessage: "Could not load the calendar. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// assertCan runs BEFORE the body is parsed. Migration 019 grants INSERT and UPDATE on `sundays`
// to every authenticated member of the ward, so RLS stops a cross-WARD write and nothing else —
// this check is the write boundary here. Validating first would hand an unauthorized caller a
// validation message that describes the route's shape before refusing them.
//
// No notification. There is no calendar trigger key in supabase/seed/notification_triggers.sql,
// and inventing one fires into nothing and only warns (lib/notifications/emitNotification.ts).
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "calendar.manage");

    const input = sundayPostSchema.parse(await readJsonBody(request));
    const supabase = await createServerSupabaseClient();

    if (input.mode === "generate") {
      const { created, monthsResolved } = await generateSundayRange(
        user.wardId,
        input.from,
        input.to,
        supabase,
      );

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "sundays_generated",
          module: "calendar",
          detail: { from: input.from, to: input.to, created, monthsResolved },
        },
        supabase,
      );

      return NextResponse.json({ created, monthsResolved }, { status: 201 });
    }

    const sunday = await createSunday(user.wardId, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "sunday_created",
        module: "calendar",
        detail: { sundayId: sunday.id, date: sunday.date, type: sunday.type },
      },
      supabase,
    );

    return NextResponse.json({ sunday }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/sundays",
      fallbackMessage: "Could not update the calendar. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
