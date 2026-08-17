import {
  createHousehold,
  createMember,
  createMemberNote,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// Six households across every member status, plus notes on one member. The shape matters more
// than the size: two households share the family name "Smith" so the tester can check they stay
// distinguishable, one household has no address, and one member has no household at all —
// that last one is invisible in the household view by construction and is the reason the flat
// list exists.
//
// seedNotificationTriggers() is not optional: without it `new_household_added` fires into
// nothing and the notification check fails for a reason unrelated to the code under test
// (plans/retros/foundation-c-services.md).

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Sarah",
    lastName: "Brooks",
  });

  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
  });

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    org: "bishopric",
    firstName: "David",
    lastName: "Nguyen",
  });

  const andersen = await createHousehold({
    familyName: "Andersen",
    address: "12 Oak Street",
  });
  const brooks = await createHousehold({
    familyName: "Brooks",
    address: "48 Willow Lane",
  });
  // Two unrelated Smith families. A unique constraint on (ward_id, family_name) would have made
  // the second one impossible, which is why migration 022's lookup indexes are not unique.
  const smithNorth = await createHousehold({
    familyName: "Smith",
    address: "3 North Road",
  });
  const smithSouth = await createHousehold({
    familyName: "Smith",
    address: "91 South Road",
  });
  const nguyen = await createHousehold({
    familyName: "Nguyen",
    address: "7 Cedar Court",
  });
  // No address on file — legitimate, and the case that makes an address-keyed match ambiguous.
  const ruiz = await createHousehold({ familyName: "Ruiz" });

  const notedMember = await createMember({
    firstName: "Mark",
    lastName: "Andersen",
    householdId: andersen,
    category: "adult",
    gender: "male",
    phone: "555-0101",
  });

  await createMember({
    firstName: "Julia",
    lastName: "Andersen",
    householdId: andersen,
    category: "adult",
    gender: "female",
    phone: "555-0102",
  });

  await createMember({
    firstName: "Ethan",
    lastName: "Andersen",
    householdId: andersen,
    category: "youth",
    gender: "male",
  });

  await createMember({
    firstName: "Sarah",
    lastName: "Brooks",
    householdId: brooks,
    category: "adult",
    gender: "female",
    phone: "555-0103",
  });

  await createMember({
    firstName: "Grace",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "female",
  });

  await createMember({
    firstName: "Daniel",
    lastName: "Smith",
    householdId: smithNorth,
    category: "adult",
    gender: "male",
    phone: "555-0104",
  });

  await createMember({
    firstName: "Rachel",
    lastName: "Smith",
    householdId: smithNorth,
    category: "adult",
    gender: "female",
  });

  await createMember({
    firstName: "Peter",
    lastName: "Smith",
    householdId: smithSouth,
    category: "adult",
    gender: "male",
    phone: "555-0105",
  });

  await createMember({
    firstName: "Lily",
    lastName: "Smith",
    householdId: smithSouth,
    category: "child",
    gender: "female",
  });

  await createMember({
    firstName: "David",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "adult",
    gender: "male",
    phone: "555-0106",
  });

  // Do Not Contact — still in the ward, so it appears on the browse page with a badge that has
  // to read clearly without relying on colour.
  await createMember({
    firstName: "Helen",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "adult",
    gender: "female",
    status: "do_not_contact",
  });

  await createMember({
    firstName: "Tomas",
    lastName: "Ruiz",
    householdId: ruiz,
    category: "adult",
    gender: "male",
    phone: "555-0107",
  });

  // Moved out — absent from every default query, retained so assignment and visit history
  // survives (02-roster.md §Pitfalls: there is no delete).
  await createMember({
    firstName: "Carlos",
    lastName: "Ruiz",
    householdId: ruiz,
    category: "adult",
    gender: "male",
    status: "moved_out",
  });

  await createMember({
    firstName: "Marta",
    lastName: "Ruiz",
    householdId: ruiz,
    category: "youth",
    gender: "female",
    status: "moved_out",
  });

  // No household. Invisible in the household view by construction; the flat list is the only
  // place this person exists, which is the whole reason for the second view.
  await createMember({
    firstName: "Jonah",
    lastName: "Whitfield",
    category: "adult",
    gender: "male",
    phone: "555-0108",
  });

  await createMemberNote({
    memberId: notedMember,
    body: "Bishopric only: asked about a temple recommend interview in September.",
    createdBy: bishop.id,
  });

  await createMemberNote({
    memberId: notedMember,
    body: "Bishopric only: new calling discussed with the ward council.",
    createdBy: bishop.id,
  });

  const triggerCount = await seedNotificationTriggers();

  console.log(
    `  ward, 4 users, 6 households, 14 members (2 moved out, 1 do not contact, 1 unhoused), ` +
      `2 member notes, ${triggerCount} notification triggers`,
  );
}
