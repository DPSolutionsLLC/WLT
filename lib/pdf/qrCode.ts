import QRCode from "qrcode";

// A public programme URL, encoded as a PNG data URI for the back panel.
//
// ---------------------------------------------------------------------------------------------
// PNG, NOT SVG
// ---------------------------------------------------------------------------------------------
// @react-pdf/renderer's <Image> accepts PNG and JPG and nothing else. Its <Svg> primitive can
// draw shapes, but a QR is ~450 individual rectangles and there is no reason to make the renderer
// lay out 450 nodes when a raster is exactly what a scanner wants. This is 06-program-music.md's
// named pitfall, and the shape of the return value is what prevents it.
//
// ---------------------------------------------------------------------------------------------
// THE TWO PHYSICAL CONSTRAINTS
// ---------------------------------------------------------------------------------------------
// A programme is folded and handled, so the code has to survive being creased and photographed at
// an angle in bad chapel lighting.
//
//   * MARGIN 4 modules. This is the "quiet zone" the QR specification requires. A code printed
//     flush to its container fails to scan when it sits against a fold, because the scanner
//     cannot find the code's boundary. Do not reduce this to reclaim space on the panel.
//
//   * ERROR CORRECTION "M" — 15% of the code can be damaged and still decode. "L" (7%) is not
//     enough for paper that gets folded; "H" (30%) makes the code denser, which needs MORE
//     printed area to stay scannable and is therefore counterproductive here.
//
//   * The printed square must be AT LEAST 20mm on a side. That is a physical constraint, not a
//     style choice — see QR_MINIMUM_SIZE_POINTS, which BackPanel uses.
const ERROR_CORRECTION_LEVEL = "M";
const QUIET_ZONE_MODULES = 4;

// 20mm in PDF points. 1pt = 1/72 inch, 1 inch = 25.4mm.
export const QR_MINIMUM_SIZE_POINTS = Math.ceil((20 / 25.4) * 72);

// Raster width in pixels. The image is placed at ~60pt, so 512px is roughly 600 DPI — comfortably
// past what any consumer printer resolves, which keeps the module edges hard instead of grey.
const RASTER_WIDTH = 512;

export async function programQrDataUri(publicUrl: string): Promise<string> {
  const trimmed = publicUrl.trim();

  // A blank URL would encode successfully and produce a scannable code that goes nowhere. Refused
  // here rather than printed — a QR is verified by a stranger in a chapel, not by a test.
  if (trimmed === "") {
    throw new Error("Cannot build a QR code for an empty URL.");
  }

  return QRCode.toDataURL(trimmed, {
    errorCorrectionLevel: ERROR_CORRECTION_LEVEL,
    margin: QUIET_ZONE_MODULES,
    width: RASTER_WIDTH,
    // Pure black on pure white. A tinted QR is a scan failure waiting for a cloudy day, and the
    // ward's primary_color deliberately does NOT reach this.
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}
