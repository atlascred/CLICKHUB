import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { ThemeProvider } from "@/providers/theme-provider";
import { Toaster } from "sonner";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], display: "swap" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#123367",
};

export const metadata: Metadata = {
  title: "CLICKHUB",
  description: "Painel comercial Click Hubnet para vendas e atendimento.",
  manifest: "/manifest.webmanifest",
  other: { "apple-mobile-web-app-capable": "yes" },
  appleWebApp: { capable: true, title: "CLICKHUB", statusBarStyle: "default" },
  icons: {
    icon: "/pwa/icon-192.png",
    shortcut: "/pwa/icon-192.png",
    apple: { url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={manrope.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <PwaProvider />
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
