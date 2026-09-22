import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caddie",
  description:
    "Which players suit the next PGA Tour course, and why, from openly-licensed data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
