import {
  createHousehold,
  createMember,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// A roster in the state a ward is in BEFORE its first paste: eight members with no full name (so
// they can only match on first + last name), in households named the old way ("Andersen") rather
// than LCR's "Head of House and Spouse". The pastes are in ./fixtures and are fake people only.
//
//   Mark Andersen      in paste 1, with a different phone
//   Carlos Andersen    MOVED OUT, and in paste 1: must come back, not be created twice
//   Helen Nguyen       DO NOT CONTACT, not in paste 1: offered as no longer listed, unticked
//   Leo Nguyen         active, not in paste 1: offered as no longer listed, unticked
//
// seedNotificationTriggers() so `new_household_added` has somewhere to go.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  const andersen = await createHousehold({ familyName: "Andersen", address: "12 Oak Street" });
  const brooks = await createHousehold({ familyName: "Brooks", address: "48 Willow Lane" });
  const nguyen = await createHousehold({ familyName: "Nguyen", address: "7 Cedar Court" });

  await createMember({
    firstName: "Mark",
    lastName: "Andersen",
    householdId: andersen,
    gender: "male",
    phone: "555-0101",
  });
  await createMember({
    firstName: "Julia",
    lastName: "Andersen",
    householdId: andersen,
    gender: "female",
  });
  await createMember({
    firstName: "Carlos",
    lastName: "Andersen",
    householdId: andersen,
    gender: "male",
    status: "moved_out",
  });
  await createMember({
    firstName: "Sarah",
    lastName: "Brooks",
    householdId: brooks,
    gender: "female",
    phone: "555-0201",
  });
  await createMember({
    firstName: "Grace",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "female",
  });
  await createMember({
    firstName: "David",
    lastName: "Nguyen",
    householdId: nguyen,
    gender: "male",
    phone: "555-0301",
  });
  await createMember({
    firstName: "Helen",
    lastName: "Nguyen",
    householdId: nguyen,
    gender: "female",
    status: "do_not_contact",
  });
  await createMember({
    firstName: "Leo",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "child",
    gender: "male",
  });
}
