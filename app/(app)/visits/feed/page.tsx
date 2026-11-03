import { redirect } from "next/navigation";

// The return-and-report feed is the Feed tab of /visits since ITER-055 bv2 (the user's choice:
// one place to maintain). This address stays so a bookmark still lands on it.
export default function VisitFeedPage() {
  redirect("/visits?tab=feed");
}
