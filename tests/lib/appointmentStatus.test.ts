import { describe, expect, it } from "vitest";
import { appointmentViewState } from "@/lib/visits/appointmentStatus";

// "Missed" is computed, never stored. This suite is what makes that claim checkable.
//
// EVERY `asOf` HERE IS PINNED. Not one test calls `new Date()` with no argument — a clock the
// test does not control cannot be asserted at its boundary, and the boundary is the whole point:
// one second either side of a scheduled time is the difference between an appointment that is
// still ahead of somebody and one they missed.
//
// Pure. No database, no network, no fixtures.

const SCHEDULED_FOR = "2026-08-25T19:00:00.000Z";
const ONE_SECOND = 1000;

const at = (isoOrOffsetMs: string | number): Date =>
  typeof isoOrOffsetMs === "number"
    ? new Date(Date.parse(SCHEDULED_FOR) + isoOrOffsetMs)
    : new Date(isoOrOffsetMs);

describe("appointmentViewState", () => {
  describe("a scheduled appointment", () => {
    it("reads as scheduled while its time is still ahead", () => {
      expect(
        appointmentViewState(
          { status: "scheduled", scheduledFor: SCHEDULED_FOR },
          at("2026-08-25T18:00:00.000Z"),
        ),
      ).toBe("scheduled");
    });

    it("reads as missed once its time has passed", () => {
      expect(
        appointmentViewState(
          { status: "scheduled", scheduledFor: SCHEDULED_FOR },
          at("2026-08-25T20:00:00.000Z"),
        ),
      ).toBe("missed");
    });

    // The boundary, in both directions and to the second. A `<=` here instead of a `<` would
    // make an appointment missed at the exact moment it was due to start, which is the one
    // moment it is most certainly not.
    it("is still scheduled one second before", () => {
      expect(
        appointmentViewState(
          { status: "scheduled", scheduledFor: SCHEDULED_FOR },
          at(-ONE_SECOND),
        ),
      ).toBe("scheduled");
    });

    it("is still scheduled at the exact scheduled instant", () => {
      expect(
        appointmentViewState({ status: "scheduled", scheduledFor: SCHEDULED_FOR }, at(0)),
      ).toBe("scheduled");
    });

    it("is missed one second after", () => {
      expect(
        appointmentViewState(
          { status: "scheduled", scheduledFor: SCHEDULED_FOR },
          at(ONE_SECOND),
        ),
      ).toBe("missed");
    });
  });

  // Somebody already answered the question, and time does not un-answer it. A kept appointment
  // in the past is kept; a cancelled one is cancelled. If these ever returned "missed", every
  // appointment a ward ever completed would eventually read as a failure.
  describe("an appointment somebody has already resolved", () => {
    it.each(["kept", "cancelled"] as const)(
      "leaves a %s appointment alone long after its time",
      (status) => {
        expect(
          appointmentViewState(
            { status, scheduledFor: SCHEDULED_FOR },
            at("2027-01-01T00:00:00.000Z"),
          ),
        ).toBe(status);
      },
    );

    it.each(["kept", "cancelled"] as const)(
      "leaves a %s appointment alone before its time too",
      (status) => {
        expect(
          appointmentViewState(
            { status, scheduledFor: SCHEDULED_FOR },
            at("2026-01-01T00:00:00.000Z"),
          ),
        ).toBe(status);
      },
    );
  });

  // The same row, read at two different moments, gives two different answers — which is exactly
  // why this is not a column. Nothing wrote to the appointment between these two calls.
  it("changes its answer for one unchanged row as the clock passes the time", () => {
    const appointment = { status: "scheduled", scheduledFor: SCHEDULED_FOR } as const;

    expect(appointmentViewState(appointment, at(-ONE_SECOND))).toBe("scheduled");
    expect(appointmentViewState(appointment, at(ONE_SECOND))).toBe("missed");
  });

  // The offset form is what <input type="datetime-local"> plus toISOString() produces, and a
  // ward keeping local time is the normal case. Parsing must compare instants, not strings.
  it("compares instants rather than strings across timezone offsets", () => {
    // 13:00 in Denver on 25 August 2026 is 19:00 UTC — the same instant as SCHEDULED_FOR.
    const denverSameInstant = "2026-08-25T13:00:00.000-06:00";

    expect(
      appointmentViewState(
        { status: "scheduled", scheduledFor: denverSameInstant },
        at(ONE_SECOND),
      ),
    ).toBe("missed");

    expect(
      appointmentViewState(
        { status: "scheduled", scheduledFor: denverSameInstant },
        at(-ONE_SECOND),
      ),
    ).toBe("scheduled");
  });
});
