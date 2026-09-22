import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
