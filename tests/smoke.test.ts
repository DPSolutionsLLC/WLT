import { describe, expect, it } from "vitest";
import { ROLES } from "@/types/domain";

describe("test runner", () => {
  it("resolves the @/ path alias", () => {
    expect(ROLES).toContain("bishop");
  });
});
