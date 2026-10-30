import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Andor Case Lab — Candidate Workspace",
  description: "Practice and evaluate an efficient document retrieval and structured-answer workflow.",
  openGraph: { title: "Andor Case Lab", description: "Candidate workspace for the Andor document intelligence challenge." },
  twitter: { card: "summary", title: "Andor Case Lab", description: "Candidate workspace for the Andor document intelligence challenge." },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
