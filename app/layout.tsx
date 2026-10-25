import type { Metadata } from "next";
import "./system.css";
import "./forms.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "Wollet",
  description:
    "Carry your cards, bank accounts, payment handles, and secure credentials safely on your device with AES-256-GCM encryption and safe QR sharing.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "Wollet" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/sora-latin-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
