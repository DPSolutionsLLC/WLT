import { Resend } from "resend";

// The Resend client factory. THE FIRST APPLICATION CODE IN THIS REPO TO USE RESEND AT ALL.
//
// RESEND_API_KEY has sat in Vercel unread since the `deployment` work: Supabase Auth holds its own
// copy for SMTP, so nothing in this codebase had ever constructed a Resend client. This is the
// first reader.
//
// SERVER-ONLY, by the same `typeof window` guard lib/ai/client.ts and lib/supabase/service.ts use.
// No NEXT_PUBLIC_ prefix on either variable, and neither is ever logged (CLAUDE.md rules 4 and 8).
if (typeof window !== "undefined") {
  throw new Error(
    "lib/email/resend.ts was imported into browser code. RESEND_API_KEY must never reach the client.",
  );
}

// Resend's shared test sender. It DELIVERS ONLY TO THE RESEND ACCOUNT OWNER'S OWN ADDRESS.
//
// This is not a detail — the `deployment` retro records it happening once already: password reset
// appeared to work and reached no ward member, and the vendor's refusal arrived as a bare Supabase
// 500 with the real cause visible only in Resend's dashboard. Treating this address as "not
// configured" is what stops the same failure being shipped a second time under a different button.
const RESEND_TEST_SENDER = "onboarding@resend.dev";

export type EmailConfiguration =
  | { configured: true; fromAddress: string }
  | { configured: false; reason: string };

// WHY THIS IS A QUESTION THE UI ASKS BEFORE IT OFFERS THE BUTTON
//
// Until a domain is verified in Resend, a send SUCCEEDS and reaches nobody but the account owner.
// A button that reports "sent to 43 people" while 42 of them receive nothing is worse than a button
// that is switched off, so distribution asks this first and says so plainly.
//
// Setting RESEND_FROM_ADDRESS to an address at a verified domain is the ONLY thing needed to turn
// email on. There is no code change and no deploy flag.
export function emailConfiguration(): EmailConfiguration {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim() ?? "";

  if (!apiKey || apiKey.trim() === "") {
    return {
      configured: false,
      reason:
        "Email is not set up yet. An administrator needs to add the Resend API key before the programme can be emailed.",
    };
  }

  if (fromAddress === "") {
    return {
      configured: false,
      reason:
        "Email distribution needs a verified sending domain. The PDF is ready to download and send manually.",
    };
  }

  if (fromAddress.toLowerCase().includes(RESEND_TEST_SENDER)) {
    return {
      configured: false,
      reason:
        "Email distribution is still using Resend's test sender, which only delivers to the Resend account owner. Verify a sending domain first — the PDF is ready to download and send manually.",
    };
  }

  return { configured: true, fromAddress };
}

let cachedClient: Resend | null = null;

// Lazily initialised, exactly like lib/ai/client.ts, so that IMPORTING this module does not require
// the key. Constructing at module scope would make every test that touches the import chain need a
// RESEND_API_KEY in its environment.
export function getResendClient(): Resend {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "RESEND_API_KEY is not set. Check emailConfiguration() before calling getResendClient().",
    );
  }

  cachedClient = new Resend(apiKey);
  return cachedClient;
}
