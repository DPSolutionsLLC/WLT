import QRCode from "qrcode";

// A join link as a QR code, shown on a leader's phone for the person beside them to scan
// (ITER-053). Browser-safe: it imports only `qrcode`. Not lib/pdf/qrCode.ts, which is sized for
// print — but the same reasoning holds: error correction "M", the 4-module quiet zone the QR
// specification requires, and pure black on white, because a tinted or cramped code fails to scan.

const ERROR_CORRECTION_LEVEL = "M";
const QUIET_ZONE_MODULES = 4;
const RASTER_WIDTH = 320;

export async function joinLinkQrDataUri(joinUrl: string): Promise<string> {
  const trimmed = joinUrl.trim();
  if (trimmed === "") {
    throw new Error("Cannot build a QR code for an empty link.");
  }

  return QRCode.toDataURL(trimmed, {
    errorCorrectionLevel: ERROR_CORRECTION_LEVEL,
    margin: QUIET_ZONE_MODULES,
    width: RASTER_WIDTH,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}
