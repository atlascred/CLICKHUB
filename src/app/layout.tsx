import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { ThemeProvider } from "@/providers/theme-provider";
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
  icons: {
    icon: "/brand/logosemfundo.png",
    shortcut: "/brand/logosemfundo.png",
    apple: "/brand/logosemfundo.png",
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
        </ThemeProvider>
      </body>
    </html>
  );
}
