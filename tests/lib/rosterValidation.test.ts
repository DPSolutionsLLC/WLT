import { describe, expect, it } from "vitest";
import { createMemberSchema, updateMemberSchema } from "@/lib/validation/roster";
import { pasteApplySchema, pastePreviewSchema } from "@/lib/validation/rosterPaste";

describe("updateMemberSchema", () => {
  // Zod 4 keeps a .default() through .partial(). Before ITER-040 this PATCH set the member back
  // to active, which would undo a move-out from the roster paste.
  it("adds no status to a PATCH that did not send one", () => {
    const parsed = updateMemberSchema.parse({ phone: "1" });

    expect(parsed).toEqual({ phone: "1" });
    expect("status" in parsed).toBe(false);
  });

  it("still accepts a status that was sent", () => {
    expect(updateMemberSchema.parse({ status: "moved_out" })).toEqual({ status: "moved_out" });
  });
});

describe("createMemberSchema", () => {
  it("still defaults a new member to active", () => {
    expect(createMemberSchema.parse({ firstName: "Ann", lastName: "Example" }).status).toBe(
      "active",
    );
  });
});

describe("roster paste schemas", () => {
  it("refuses an empty paste with a sentence", () => {
    const result = pastePreviewSchema.safeParse({ text: "" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Paste the ward list report first.");
  });

  it("refuses an apply without a valid paste hash", () => {
    const result = pasteApplySchema.safeParse({ text: "x", pasteHash: "abc", selectedIds: [] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Review the paste before applying it.");
  });

  it("refuses an unknown field, so nothing but the ticks crosses from the client", () => {
    const result = pasteApplySchema.safeParse({
      text: "x",
      pasteHash: "a".repeat(64),
      selectedIds: [],
      wardId: "someone-elses",
    });

    expect(result.success).toBe(false);
  });
});
