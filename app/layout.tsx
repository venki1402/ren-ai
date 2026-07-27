import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { ACCENTS, DEFAULT_ACCENT, type AccentId } from "@/lib/theme";
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
  title: "Ren — one idea, tuned for every platform",
  description:
    "Research, draft, refine, and publish platform-tuned posts with a human always in the loop.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookie = (await cookies()).get("ren-accent")?.value;
  const accent: AccentId =
    cookie && cookie in ACCENTS ? (cookie as AccentId) : DEFAULT_ACCENT;

  return (
    <ClerkProvider>
      <html
        lang="en"
        data-accent={accent}
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full">{children}</body>
      </html>
    </ClerkProvider>
  );
}
