import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "CleanGrid — Hybrid Data Cleaning Platform",
  description:
    "Split-screen data cleaning workbench: manual action zone with a Polars-backed grid and an AI co-pilot that profiles, suggests and applies fixes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="bg-ink font-sans text-zinc-200 antialiased">{children}</body>
    </html>
  );
}
