import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
