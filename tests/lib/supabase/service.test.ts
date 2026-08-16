import { describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

describe("createServiceSupabaseClient", () => {
  it("throws when called in a browser environment", () => {
    expect(typeof window).not.toBe("undefined");
    expect(() => createServiceSupabaseClient()).toThrow(
      /must never reach the client/,
    );
  });
});
