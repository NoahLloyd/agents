import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const FAVICON_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>` +
  `<rect width='32' height='32' rx='7' fill='%2309090b'/>` +
  `<circle cx='8' cy='16' r='3' fill='%2334d399'/>` +
  `<circle cx='16' cy='16' r='3' fill='%23a1a1aa'/>` +
  `<circle cx='24' cy='16' r='3' fill='%23a1a1aa'/>` +
  `</svg>`;

export const metadata: Metadata = {
  title: "agents",
  description: "",
  icons: { icon: `data:image/svg+xml;utf8,${FAVICON_SVG}` },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
