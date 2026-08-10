import type { Metadata } from "next";
import { headers } from "next/headers";
import { Archivo_Black, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const display = Archivo_Black({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  const description = "Turn your hand into a digital spray can and paint the wall without touching the screen.";
  return {
    metadataBase: new URL(origin),
    title: "AIRCAN — The Wall Is Live",
    description,
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      title: "AIRCAN — The Wall Is Live",
      description,
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1672, height: 941, alt: "AIRCAN — Your hand. The wall. No rules." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "AIRCAN — The Wall Is Live",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable} ${mono.variable}`}>
        {children}
      </body>
    </html>
  );
}
