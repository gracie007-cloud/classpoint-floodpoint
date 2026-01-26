import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ScannerProvider } from "@/contexts/scanner-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Floodpoint - ClassPoint Bot Manager",
    template: "%s | Floodpoint",
  },
  description:
    "Create multiple bot connections to ClassPoint sessions with custom usernames. Features include real-time connection monitoring and a class code scanner.",
  keywords: ["ClassPoint", "bot", "SignalR", "WebSocket", "education", "presentation"],
  authors: [{ name: "avkean", url: "https://github.com/avkean" }],
  creator: "avkean",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://floodpoint.akean.dev",
    title: "Floodpoint - ClassPoint Bot Manager",
    description:
      "Create multiple bot connections to ClassPoint sessions with custom usernames.",
    siteName: "Floodpoint",
  },
  twitter: {
    card: "summary_large_image",
    title: "Floodpoint - ClassPoint Bot Manager",
    description:
      "Create multiple bot connections to ClassPoint sessions with custom usernames.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        <ScannerProvider>
          {children}
          <Toaster 
            position="bottom-right" 
            theme="dark"
            toastOptions={{
              style: {
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
              },
            }}
          />
        </ScannerProvider>
      </body>
    </html>
  );
}
