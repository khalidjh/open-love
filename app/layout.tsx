import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import AppToaster from "@/components/ui/AppToaster";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const SITE_URL = "https://build.etlaq.sa";
const SITE_NAME = "Etlaq";
const SITE_TAGLINE = "Build web apps with AI";
const SITE_DESCRIPTION =
  "Etlaq turns a prompt into a working web app in seconds. Describe what you want, chat to refine it, and preview your app live — powered by AI.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  keywords: [
    "Etlaq",
    "إطلاق",
    "AI app builder",
    "AI website builder",
    "build web apps with AI",
    "AI code generation",
    "prompt to app",
    "no-code",
    "React app generator",
    "Next.js",
    "Saudi Arabia",
  ],
  category: "technology",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/etlaq-logo.svg",
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — ${SITE_TAGLINE}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ["/etlaq-logo.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/etlaq-logo.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/etlaq-logo.svg" }],
  },
};

// viewport-fit=cover is required for env(safe-area-inset-*) to resolve to real
// values on notched / gesture-bar devices (used by the chat header + composer).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Disable pinch-zoom on mobile (app-like behavior).
  maximumScale: 1,
  userScalable: false,
  themeColor: "#fbfafd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
