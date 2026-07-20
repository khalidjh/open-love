import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import AppToaster from "@/components/ui/AppToaster";
import { LanguageProvider, LANG_COOKIE } from "@/lib/i18n/LanguageProvider";
import { dir as dirOf, type Lang } from "@/lib/i18n/dictionary";
import LanguageSwitcher from "@/components/LanguageSwitcher";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

// Arabic UI typeface, applied when the app is in RTL (see globals.css).
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
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

// Read the language cookie per request (so RTL/Arabic is correct on first paint).
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the language server-side from the cookie so <html lang/dir> is correct
  // on first paint (no flash of the wrong direction).
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = cookieLang === "ar" ? "ar" : "en";

  return (
    <html lang={lang} dir={dirOf(lang)}>
      <body className={`${geistSans.variable} ${geistMono.variable} ${plexArabic.variable} font-sans`}>
        <LanguageProvider initialLang={lang}>
          {children}
          <LanguageSwitcher className="fixed bottom-16 ltr:left-16 rtl:right-16 z-[60] shadow-sm" />
          <AppToaster />
        </LanguageProvider>
      </body>
    </html>
  );
}
