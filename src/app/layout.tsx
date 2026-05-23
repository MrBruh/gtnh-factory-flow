import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "./Analytics";
import "./globals.css";

const monocraft = localFont({
  src: [
    { path: "./fonts/Monocraft-ExtraLight.ttf", weight: "200", style: "normal" },
    { path: "./fonts/Monocraft-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Monocraft.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Monocraft-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Monocraft-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Monocraft-Black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-minecraft",
  display: "swap",
});

export const metadata: Metadata = {
  applicationName: "GTNH Planner",
  title: "GTNH Planner | GregTech New Horizons Factory Calculator",
  description:
    "Plan and optimize GregTech: New Horizons factories with a GTNH recipe flowchart, throughput calculator, machine ratios, and dataset-backed production chains.",
  keywords: [
    "GTNH Planner",
    "GregTech New Horizons planner",
    "GTNH factory planner",
    "GTNH recipe calculator",
    "GTNH throughput calculator",
    "GregTech factory calculator",
  ],
  openGraph: {
    title: "GTNH Planner | GregTech New Horizons Factory Calculator",
    description:
      "Build GTNH recipe flowcharts, calculate throughput, balance machine ratios, and plan production chains for GregTech: New Horizons.",
    siteName: "GTNH Planner",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "GTNH Planner | GregTech New Horizons Factory Calculator",
    description:
      "Build GTNH recipe flowcharts, calculate throughput, balance machine ratios, and plan production chains for GregTech: New Horizons.",
  },
  icons: {
    icon: "/site-icon.png",
    shortcut: "/site-icon.png",
    apple: "/site-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${monocraft.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
