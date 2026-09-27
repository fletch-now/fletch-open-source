import type { Metadata, Viewport } from "next";
import { APP_URL } from "@/lib/config";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/seo";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { BuildActivity } from "@/components/dashboard/build-activity";
import { HolderRewardMonitor } from "@/components/holder-rewards/client";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Inherited by every page. A page that says nothing of its own still gets the
// site's name in its title, a canonical URL, and the share card drawn by
// app/opengraph-image.tsx.
export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: SITE_TAGLINE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: APP_URL,
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, address: false, email: false },
  category: "technology",
};

// The browser chrome matches the hero, which is the first thing on the page.
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e0d" },
  ],
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">): React.ReactNode {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <BuildActivity />
        <HolderRewardMonitor />
        <Toaster
          position="bottom-right"
          offset={20}
          toastOptions={{
            style: {
              borderRadius: "12px",
              border: "1px solid rgb(14 16 15 / 0.09)",
              background: "#ffffff",
              color: "#0e100f",
              fontSize: "13.5px",
            },
          }}
        />
      </body>
    </html>
  );
}
