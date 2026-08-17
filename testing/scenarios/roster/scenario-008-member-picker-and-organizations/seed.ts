import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createTestUser,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// 24 members across 8 households, shaped so every prop on MemberPicker's frozen interface has
// something to bite on: both genders in every category, two members who have moved out, two
// marked do-not-contact, one member with no household at all, and two households sharing the
// family name "Smith".
//
// The spread is the point rather than the size. A picker filtered to youth must have youth of
// both genders to choose between; the do-not-contact confirmation needs someone to reveal; and
// the moved-out pair is what proves no filter setting can offer them.
//
// No notification triggers are seeded: nothing in roster-b emits one. Assigning a member to an
// organization is not an event anybody asked to be told about.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
  });

  await createTestUser({
    handle: "rspres",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Sarah",
    lastName: "Brooks",
  });

  const andersen = await createHousehold({
    familyName: "Andersen",
    address: "12 Oak Street",
  });
  const brooks = await createHousehold({
    familyName: "Brooks",
    address: "48 Willow Lane",
  });
  // Two unrelated Smith families, so the tester can check they stay distinguishable inside the
  // picker's household grouping as well as on the roster page.
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
  const ruiz = await createHousehold({ familyName: "Ruiz" });
  const okafor = await createHousehold({
    familyName: "Okafor",
    address: "22 Elm Avenue",
  });
  const whitfield = await createHousehold({
    familyName: "Whitfield",
    address: "5 Maple Close",
  });

  // --- Adults (12) ------------------------------------------------------------------
  const mark = await createMember({
    firstName: "Mark",
    lastName: "Andersen",
    householdId: andersen,
    category: "adult",
    gender: "male",
    phone: "555-0101",
  });
  const julia = await createMember({
    firstName: "Julia",
    lastName: "Andersen",
    householdId: andersen,
    category: "adult",
    gender: "female",
    phone: "555-0102",
  });
  const sarah = await createMember({
    firstName: "Sarah",
    lastName: "Brooks",
    householdId: brooks,
    category: "adult",
    gender: "female",
    phone: "555-0103",
  });
  const daniel = await createMember({
    firstName: "Daniel",
    lastName: "Smith",
    householdId: smithNorth,
    category: "adult",
    gender: "male",
    phone: "555-0104",
  });
  const rachel = await createMember({
    firstName: "Rachel",
    lastName: "Smith",
    householdId: smithNorth,
    category: "adult",
    gender: "female",
  });
  const peter = await createMember({
    firstName: "Peter",
    lastName: "Smith",
    householdId: smithSouth,
    category: "adult",
    gender: "male",
    phone: "555-0105",
  });
  const david = await createMember({
    firstName: "David",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "adult",
    gender: "male",
    phone: "555-0106",
  });

  // Do Not Contact, and a member of the Relief Society — so revealing them in a picker is a
  // real decision rather than a member nobody would have chosen anyway.
  const helen = await createMember({
    firstName: "Helen",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "adult",
    gender: "female",
    status: "do_not_contact",
  });

  const tomas = await createMember({
    firstName: "Tomas",
    lastName: "Ruiz",
    householdId: ruiz,
    category: "adult",
    gender: "male",
    phone: "555-0107",
  });

  // Moved out, and in no organization. He must not appear in a picker under ANY filter setting
  // — that is the assertion every downstream number in the app rests on.
  await createMember({
    firstName: "Carlos",
    lastName: "Ruiz",
    householdId: ruiz,
    category: "adult",
    gender: "male",
    status: "moved_out",
  });

  const ada = await createMember({
    firstName: "Ada",
    lastName: "Okafor",
    householdId: okafor,
    category: "adult",
    gender: "female",
    phone: "555-0109",
  });

  // No household. Invisible in the household grouping by construction, which is why the picker
  // gives them a group of their own rather than dropping them.
  const jonah = await createMember({
    firstName: "Jonah",
    lastName: "Whitfield",
    category: "adult",
    gender: "male",
    phone: "555-0108",
  });

  // --- Youth (8) --------------------------------------------------------------------
  await createMember({
    firstName: "Ethan",
    lastName: "Andersen",
    householdId: andersen,
    category: "youth",
    gender: "male",
  });
  await createMember({
    firstName: "Grace",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "female",
  });
  await createMember({
    firstName: "Owen",
    lastName: "Smith",
    householdId: smithNorth,
    category: "youth",
    gender: "male",
  });
  await createMember({
    firstName: "Chloe",
    lastName: "Smith",
    householdId: smithSouth,
    category: "youth",
    gender: "female",
  });
  await createMember({
    firstName: "Kevin",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "youth",
    gender: "male",
  });

  // The second moved-out member, and a youth — so a youth-filtered picker is also proved to
  // exclude them, not only an unfiltered one.
  await createMember({
    firstName: "Marta",
    lastName: "Ruiz",
    householdId: ruiz,
    category: "youth",
    gender: "female",
    status: "moved_out",
  });

  // The second do-not-contact member, and a youth. Phase 10 draws sacrament ordinance
  // assignments from youth by category and gender, so the confirmation path has to be checked
  // on a youth as well as on an adult.
  await createMember({
    firstName: "Zara",
    lastName: "Okafor",
    householdId: okafor,
    category: "youth",
    gender: "female",
    status: "do_not_contact",
  });

  await createMember({
    firstName: "Sam",
    lastName: "Whitfield",
    householdId: whitfield,
    category: "youth",
    gender: "male",
  });

  // --- Children (4) -----------------------------------------------------------------
  await createMember({
    firstName: "Noah",
    lastName: "Brooks",
    householdId: brooks,
    category: "child",
    gender: "male",
  });
  await createMember({
    firstName: "Lily",
    lastName: "Smith",
    householdId: smithSouth,
    category: "child",
    gender: "female",
  });
  await createMember({
    firstName: "Emeka",
    lastName: "Okafor",
    householdId: okafor,
    category: "child",
    gender: "male",
  });
  await createMember({
    firstName: "Ruby",
    lastName: "Whitfield",
    householdId: whitfield,
    category: "child",
    gender: "female",
  });

  // --- Organization membership ------------------------------------------------------
  // 6 in the elders quorum, 5 in the relief society, and 2 of those also in Primary — the
  // "in two organizations" case, which is what the member panel's checkbox list has to render
  // correctly and what a replace-the-whole-set save has to preserve. The remaining 13 members
  // belong to none, which is what makes the bulk-assign flow worth walking through.
  for (const memberId of [mark, daniel, peter, david, tomas, jonah]) {
    await addMemberToOrganization({ memberId, org: "eldersQuorum" });
  }

  for (const memberId of [julia, sarah, rachel, ada, helen]) {
    await addMemberToOrganization({ memberId, org: "reliefSociety" });
  }

  for (const memberId of [sarah, rachel]) {
    await addMemberToOrganization({ memberId, org: "primary" });
  }

  console.log(
    "  ward, 3 users, 8 households, 24 members (12 adult, 8 youth, 4 child; " +
      "2 moved out, 2 do not contact, 1 unhoused), 13 organization memberships",
  );
}
