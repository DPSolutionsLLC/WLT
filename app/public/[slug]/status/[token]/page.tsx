import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusPanel } from "./StatusPanel";
import { resolveSiteUrl } from "@/lib/program/queries";
import { getRegistrationStatus } from "@/lib/zoom/publicRegistration";
import { registrationPageUrl } from "@/lib/zoom/registrationTokens";

// ONE REGISTRANT'S OWN ZOOM SIGN-UP STATUS (ITER-052). The secret token in the URL is the only key:
// it shows "waiting", their personal join link once approved, or a neutral "not this time" (D2) —
// and never a reason, a phone number, or anybody else's data (migration 096's
// zoom_registration_status() returns no more than that).
//
// DYNAMIC, NEVER CACHED: it changes the moment the bishopric approves, and it is one person's page.
// `no-referrer`, so the token never leaves in a Referer header when they tap Join.
//
// An unknown token, a malformed one, and one whose slug does not match the URL all reach
// notFound() — one outcome for every way of not existing (program-c). A database error throws.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your stream link",
  referrer: "no-referrer",
};

export default async function RegistrationStatusPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;

  const status = await getRegistrationStatus(token);
  if (!status || status.slug !== slug) notFound();

  return (
    <StatusPanel
      displayName={status.displayName}
      wardName={status.wardName}
      status={status.status}
      linkGiven={status.linkGiven}
      joinUrl={status.joinUrl}
      shareUrl={registrationPageUrl(resolveSiteUrl(), status.slug, status.referralCode)}
      sharePath={`/public/${encodeURIComponent(status.slug)}?ref=${encodeURIComponent(status.referralCode)}`}
    />
  );
}
