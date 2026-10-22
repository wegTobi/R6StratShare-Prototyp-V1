import type { Metadata } from "next";
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
  metadataBase: new URL(process.env.R6_SITE_URL || "https://r6stratshare.example"),
  title: "R6 StratShare",
  description:
    "A dark tracker-inspired tactical hub for Rainbow Six Siege strats.",
  openGraph: {
    title: "R6 StratShare",
    description:
      "Map, site, and slot-based strategies in a compact team dashboard.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "R6 StratShare",
    description:
      "Dark strat dashboard with map layouts, operator slots, and JSON export.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
