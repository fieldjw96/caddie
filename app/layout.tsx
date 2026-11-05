import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font: no request reaches Google from a reader's browser.
// Barlow for running text; Barlow Condensed, uppercase, for the scoreboard's headings and
// numbers.
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-barlow",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  variable: "--font-barlow-condensed",
});

export const metadata: Metadata = {
  title: "Caddie: which Players suit the next PGA Tour Course",
  description:
    "The next PGA Tour Tournament's Course, described from openly-licensed data, and the field ranked by a Fit Score whose Weightings are on display and adjustable.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
