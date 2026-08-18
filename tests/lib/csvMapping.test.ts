import { describe, expect, it } from "vitest";
import {
  describeMissingFields,
  missingRequiredFields,
  suggestMapping,
} from "@/lib/roster/csv/columnMapping";

// Every assertion here is about header TEXT, never header position. 02-roster.md §Pitfalls opens
// with the reason: LCR column order changes between exports, and a positional mapping imports
// phone numbers into the address column the first time it moves.

describe("suggestMapping", () => {
  it("maps the documented aliases for every field", () => {
    const headers = [
      "First Name",
      "Last Name",
      "Household Name",
      "Street Address",
      "Age Category",
      "Gender",
      "Individual Phone",
    ];

    expect(suggestMapping(headers)).toEqual({
      firstName: 0,
      lastName: 1,
      familyName: 2,
      address: 3,
      category: 4,
      gender: 5,
      phone: 6,
    });
  });

  it("ignores case, punctuation and spacing in a header", () => {
    const headers = ["  PREFERRED_NAME  ", "sur-name", "Household  Name"];

    expect(suggestMapping(headers)).toEqual({
      firstName: 0,
      lastName: 1,
      familyName: 2,
    });
  });

  // The position-independence guarantee, stated as a test rather than as a comment.
  it("maps identically when the columns are in a different order", () => {
    const inOneOrder = suggestMapping([
      "First Name",
      "Last Name",
      "Household Name",
      "Phone",
    ]);
    const shuffled = suggestMapping([
      "Phone",
      "Household Name",
      "First Name",
      "Last Name",
    ]);

    expect(inOneOrder).toEqual({ firstName: 0, lastName: 1, familyName: 2, phone: 3 });
    expect(shuffled).toEqual({ phone: 0, familyName: 1, firstName: 2, lastName: 3 });
  });

  // The ambiguity rule. "Family Name" means the surname in some exports and the household in
  // others, and a silent guess mis-groups the entire ward into households named after people.
  it("gives an ambiguous Family Name to lastName and leaves familyName unmapped", () => {
    const mapping = suggestMapping(["First Name", "Family Name", "Address"]);

    expect(mapping.lastName).toBe(1);
    expect(mapping.familyName).toBeUndefined();
  });

  it("leaves familyName unmapped when Last Name has already claimed its column", () => {
    const mapping = suggestMapping(["First Name", "Last Name", "Family Name"]);

    expect(mapping.lastName).toBe(1);
    expect(mapping.familyName).toBeUndefined();
  });

  // An unambiguous header claims its field first, so the household column cannot be stolen by
  // lastName purely because it happens to sit further left.
  it("lets an unambiguous header win over an ambiguous one to its left", () => {
    const mapping = suggestMapping(["Family Name", "Last Name"]);

    expect(mapping.lastName).toBe(1);
    expect(mapping.familyName).toBeUndefined();
  });

  it("never assigns one column to two fields", () => {
    const mapping = suggestMapping([
      "Name",
      "Family Name",
      "Household Name",
      "Phone",
      "Mobile Phone",
    ]);

    const indexes = Object.values(mapping);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("leaves both name fields unmapped for an export with a single Name column", () => {
    const mapping = suggestMapping(["Name", "Address", "Phone"]);

    expect(mapping.firstName).toBeUndefined();
    expect(mapping.lastName).toBeUndefined();
  });

  it("ignores a header it does not recognise", () => {
    expect(suggestMapping(["Ministering District", "Record Number"])).toEqual({});
  });
});

describe("missingRequiredFields", () => {
  it("names every unmapped required field", () => {
    expect(missingRequiredFields({})).toEqual(["firstName", "lastName", "familyName"]);
  });

  it("names only what is still missing", () => {
    expect(missingRequiredFields({ firstName: 0, lastName: 1 })).toEqual(["familyName"]);
  });

  it("returns nothing when all three are mapped", () => {
    expect(
      missingRequiredFields({ firstName: 0, lastName: 1, familyName: 2, phone: 9 }),
    ).toEqual([]);
  });
});

describe("describeMissingFields", () => {
  it("names a single missing field", () => {
    expect(describeMissingFields(["familyName"], ["A", "B"])).toBe(
      "Choose a column for Household name before continuing.",
    );
  });

  it("names several missing fields in one sentence", () => {
    expect(describeMissingFields(["firstName", "familyName"], ["A"])).toContain(
      "First name and Household name",
    );
  });

  // Guessing at name splitting is how a roster ends up with people called "Van". The refusal has
  // to say what to do instead, or the user has no path forward at all.
  it("tells the user to split a single Name column rather than listing two missing fields", () => {
    const message = describeMissingFields(
      ["firstName", "lastName"],
      ["Name", "Household Name"],
    );

    expect(message).toBe(
      "This export has names in a single column. Split Name into First Name and Last Name before importing.",
    );
  });

  it("returns nothing when nothing is missing", () => {
    expect(describeMissingFields([], ["A"])).toBe("");
  });
});
