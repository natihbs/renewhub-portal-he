import type { Metadata, Viewport } from "next";
import "@fontsource-variable/heebo";
import "@fontsource-variable/frank-ruhl-libre";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "MINDTRAP · EXPERIMENT 001: THE INEVITABLE",
  description: "ארבע החלטות. תחזית אחת חתומה מראש. נראה אם תצליח לשנות אותה.",
  openGraph: {
    title: "MINDTRAP · EXPERIMENT 001",
    description: "ארבע החלטות. תחזית אחת חתומה מראש. נראה אם תצליח לשנות אותה.",
    locale: "he_IL",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0B101B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <div className="atmosphere" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
