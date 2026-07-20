import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import AppToaster from "@/components/ui/AppToaster";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";

// Runs before first paint (no SSR cookie dependency): set <html lang/dir> from the
// saved language so RTL/Arabic never flashes as LTR. The provider keeps it in sync
// after hydration.
const SET_DIR_SCRIPT = `try{var m=document.cookie.match(/etlaq_lang=(ar|en)/);var l=(m&&m[1])||localStorage.getItem('etlaq_lang')||'en';var e=document.documentElement;e.lang=l;e.dir=l==='ar'?'rtl':'ltr';}catch(_){}`;

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SET_DIR_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${plexArabic.variable} font-sans`}>
        <LanguageProvider>
          {children}
          <LanguageSwitcher className="fixed bottom-16 ltr:right-16 rtl:left-16 z-[60] shadow-sm" />
          <AppToaster />
        </LanguageProvider>
      </body>
    </html>
  );
}
