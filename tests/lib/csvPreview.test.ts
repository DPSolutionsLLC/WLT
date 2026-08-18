import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { buildImportPreview } from "@/lib/roster/csv/buildImportPreview";
import type { NormalizedRow } from "@/lib/roster/csv/normalizeRow";
import type { Database } from "@/types/database";

// The diff is computed from an INJECTED client, so this suite needs no network. The point of
// injecting rather than mocking the module is the last assertion in the file: "the preview
// writes nothing" has to be asserted against the CLIENT. An assertion about the returned
// preview would pass just as happily if the module had inserted 400 households on the way.

const WARD_ID = "ward-a";

type FakeRows = { households: unknown[]; members: unknown[] };

function createFakeClient(rows: FakeRows): {
  client: SupabaseClient<Database>;
  writes: string[];
} {
  const writes: string[] = [];

  function builder(table: string) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      or: () => chain,
      ilike: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      insert: () => {
        writes.push(`insert:${table}`);
        return chain;
      },
      update: () => {
        writes.push(`update:${table}`);
        return chain;
      },
      upsert: () => {
        writes.push(`upsert:${table}`);
        return chain;
      },
      delete: () => {
        writes.push(`delete:${table}`);
        return chain;
      },
      // Thenable, so `await query` hands back {data, error} the way PostgREST does.
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        const data = table === "households" ? rows.households : rows.members;
        resolve({ data, error: null });
      },
    };

    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string) => {
      writes.push(`rpc:${name}`);
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { client: client as unknown as SupabaseClient<Database>, writes };
}

function household(id: string, familyName: string, address: string | null) {
  return {
    id,
    family_name: familyName,
    address,
    latitude: null,
    longitude: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function member(
  id: string,
  firstName: string,
  lastName: string,
  householdId: string | null,
  status = "active",
) {
  return {
    id,
    household_id: householdId,
    first_name: firstName,
    last_name: lastName,
    category: "adult",
    gender: null,
    status,
    phone: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function incoming(
  rowNumber: number,
  firstName: string,
  lastName: string,
  familyName: string,
  address: string | null,
): NormalizedRow {
  return {
    rowNumber,
    firstName,
    lastName,
    familyName,
    address,
    category: null,
    gender: null,
    phone: null,
  };
}

// Two households and three members, one of whom has moved out.
const EXISTING: FakeRows = {
  households: [
    household("h-andersen", "Andersen", "12 Oak Street"),
    household("h-smith", "Smith", "3 North Road"),
  ],
  members: [
    member("m-mark", "Mark", "Andersen", "h-andersen"),
    member("m-carlos", "Carlos", "Departed", "h-andersen", "moved_out"),
    member("m-daniel", "Daniel", "Smith", "h-smith"),
  ],
};

describe("buildImportPreview", () => {
  it("counts new and matching households and members", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(
      WARD_ID,
      [
        incoming(2, "Mark", "Andersen", "Andersen", "12 Oak Street"),
        incoming(3, "Julia", "Andersen", "Andersen", "12 Oak Street"),
        incoming(4, "Ada", "Okafor", "Okafor", "22 Elm Avenue"),
      ],
      "hash",
      [],
      client,
    );

    expect(preview.totalRows).toBe(3);
    expect(preview.matchedHouseholdCount).toBe(1);
    expect(preview.newHouseholds).toEqual([
      { familyName: "Okafor", address: "22 Elm Avenue", memberCount: 1 },
    ]);
    expect(preview.matchedMemberCount).toBe(1);
    expect(preview.newMemberCount).toBe(2);
  });

  // The reason this module overrides roster-a's active-only default. A moved-out member matched
  // as new would leave the ward with two of them and no way to tell which one the history hangs
  // off.
  it("matches a moved_out member rather than counting them as new", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(
      WARD_ID,
      [incoming(2, "Carlos", "Departed", "Andersen", "12 Oak Street")],
      "hash",
      [],
      client,
    );

    expect(preview.matchedMemberCount).toBe(1);
    expect(preview.newMemberCount).toBe(0);
  });

  it("matches despite differences in case and surrounding whitespace", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(
      WARD_ID,
      [incoming(2, "  mark ", "ANDERSEN", "  aNdErSeN  ", " 12 OAK STREET ")],
      "hash",
      [],
      client,
    );

    expect(preview.matchedHouseholdCount).toBe(1);
    expect(preview.matchedMemberCount).toBe(1);
    expect(preview.newHouseholds).toEqual([]);
  });

  it("keeps two households with the same family name and different addresses apart", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(
      WARD_ID,
      [incoming(2, "Peter", "Smith", "Smith", "91 South Road")],
      "hash",
      [],
      client,
    );

    expect(preview.matchedHouseholdCount).toBe(0);
    expect(preview.newHouseholds).toEqual([
      { familyName: "Smith", address: "91 South Road", memberCount: 1 },
    ]);
  });

  // Decision 5's number, and the one the preview screen puts in front of the user so they are
  // not left wondering what happened to the rest of the ward.
  it("counts the roster members absent from the file as untouched", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(
      WARD_ID,
      [incoming(2, "Mark", "Andersen", "Andersen", "12 Oak Street")],
      "hash",
      [],
      client,
    );

    // Carlos and Daniel are in the roster and not in this file.
    expect(preview.untouchedMemberCount).toBe(2);
  });

  it("counts every roster member as untouched for an empty file", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(WARD_ID, [], "hash", [], client);

    expect(preview.untouchedMemberCount).toBe(3);
    expect(preview.newMemberCount).toBe(0);
  });

  // A file listing the same person twice must not report one more member than the apply will
  // create, or the mismatch reads as the import having silently dropped somebody.
  it("counts a person listed twice in one file once", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(
      WARD_ID,
      [
        incoming(2, "Ada", "Okafor", "Okafor", "22 Elm Avenue"),
        incoming(3, "Ada", "Okafor", "Okafor", "22 Elm Avenue"),
      ],
      "hash",
      [],
      client,
    );

    expect(preview.newMemberCount).toBe(1);
    expect(preview.newHouseholds[0].memberCount).toBe(2);
  });

  it("carries the file hash and the problems it was given through unchanged", async () => {
    const { client } = createFakeClient(EXISTING);

    const preview = await buildImportPreview(
      WARD_ID,
      [],
      "abc123",
      [{ rowNumber: 7, message: "Last name is missing, so this row was not imported." }],
      client,
    );

    expect(preview.fileHash).toBe("abc123");
    expect(preview.problems).toEqual([
      { rowNumber: 7, message: "Last name is missing, so this row was not imported." },
    ]);
  });

  // Asserted against the CLIENT, not against the result. This is the whole guarantee.
  it("writes nothing", async () => {
    const { client, writes } = createFakeClient(EXISTING);

    await buildImportPreview(
      WARD_ID,
      [
        incoming(2, "Mark", "Andersen", "Andersen", "12 Oak Street"),
        incoming(3, "Ada", "Okafor", "Okafor", "22 Elm Avenue"),
      ],
      "hash",
      [],
      client,
    );

    expect(writes).toEqual([]);
  });
});
