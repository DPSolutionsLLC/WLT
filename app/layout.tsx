import type { Metadata, Viewport } from "next";
import { Fraunces, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

// Two families, loaded through next/font so the CSS and the font files are self-hosted and there
// is no @import round trip to Google on first paint. Inter is the body face and resolves through
// --font-sans in globals.css, so no className on <body> changes; Fraunces is the display face and
// is reached with `font-display` (SectionHeader and page titles), never as a default.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ward Leadership Tools",
  description:
    "A mobile-first platform for LDS ward leadership to coordinate, track, and manage the full scope of their responsibilities.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Runs before first paint, so the page never renders light and then flips to dark. A deferred
// or componentised version cannot do this — the class has to be on <html> before the browser
// paints. This is the one sanctioned use of dangerouslySetInnerHTML in the codebase, and it is
// safe because the string is a constant: no user input reaches it. The try/catch is for
// browsers where localStorage is blocked; a storage failure must not blank the page.
// suppressHydrationWarning on <html> is what keeps React from objecting to the added class.
const THEME_SCRIPT = `try{var t=localStorage.theme;var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
