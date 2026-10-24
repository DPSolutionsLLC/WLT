import { describe, expect, it } from "vitest";
import {
  PLANNER_COLLECTIONS,
  collectionNameFor,
  parseCollectionName,
} from "@/lib/sacramentPlanner/collections";

describe("parseCollectionName", () => {
  it("reads a bare name as the real layer", () => {
    expect(parseCollectionName("sundays")).toEqual({ layer: "real", collection: "sundays" });
  });

  it("reads a t_ name as the practice layer of the same collection", () => {
    expect(parseCollectionName("t_sundays")).toEqual({ layer: "practice", collection: "sundays" });
  });

  it("knows every collection the Planner uses, in both layers", () => {
    for (const collection of PLANNER_COLLECTIONS) {
      expect(parseCollectionName(collection).collection).toBe(collection);
      expect(parseCollectionName(`t_${collection}`).layer).toBe("practice");
    }
  });

  it.each(["", "t_", "agendas", "t_agendas", "Sundays", "tt_sundays"])(
    "throws on %j",
    (name) => {
      expect(() => parseCollectionName(name)).toThrow(/not a Sacrament Planner collection/);
    },
  );

  it("round-trips through collectionNameFor", () => {
    expect(collectionNameFor(parseCollectionName("t_marks"))).toBe("t_marks");
    expect(collectionNameFor(parseCollectionName("marks"))).toBe("marks");
  });
});
