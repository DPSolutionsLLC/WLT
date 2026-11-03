import { redirect } from "next/navigation";

// Every organization at once is the All organizations tab of /visits since ITER-055 bv2, shown to
// the bishopric only. /visits decides the gate; anybody else lands on Households. This address
// stays so a bookmark still works.
export default function AllOrganizationsPage() {
  redirect("/visits?tab=all_organizations");
}
