import { createHash, randomBytes, randomInt } from "node:crypto";

// THE ZOOM SIGN-UP'S SECRET STATUS TOKEN AND ITS SHAREABLE REFERRAL CODE (ITER-052, plan P6).
//
// The status token is 32 random bytes, base64url — 43 characters — and opens one registrant's own
// status page, which shows their personal join link once approved. Only its SHA-256 is stored
// (zoom_registrations.status_token_hash), so a leaked row cannot open anybody's page; migration
// 096's zoom_registration_status() hashes what it is given the same way.
//
// The referral code is a separate, short, non-secret code put on "Share with a friend" links. It is
// never the token, so sharing can never share a person's own link.
//
// NEVER LOG A TOKEN. Server-only, by the `typeof window` guard lib/email/resend.ts uses: the page
// builds every URL on the server and hands the finished string to the browser.
if (typeof window !== "undefined") {
  throw new Error("lib/zoom/registrationTokens.ts was imported into browser code.");
}

const TOKEN_BYTES = 32;
const REFERRAL_CODE_LENGTH = 10;
const REFERRAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function hashStatusToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createStatusToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashStatusToken(token) };
}

export function createReferralCode(): string {
  let code = "";
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    code += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  }
  return code;
}

export function statusPagePath(slug: string, token: string): string {
  return `/public/${encodeURIComponent(slug)}/status/${encodeURIComponent(token)}`;
}

export function statusPageUrl(siteUrl: string | null, slug: string, token: string): string | null {
  return siteUrl === null ? null : `${siteUrl}${statusPagePath(slug, token)}`;
}

export function registrationPageUrl(
  siteUrl: string | null,
  slug: string,
  referralCode?: string | null,
): string | null {
  if (siteUrl === null) return null;
  const base = `${siteUrl}/public/${encodeURIComponent(slug)}`;
  return referralCode ? `${base}?ref=${encodeURIComponent(referralCode)}` : base;
}
