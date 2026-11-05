import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Glassbox",
  description: "Read-only auditor for AI agents on NEAR.",
  icons: { icon: "/glassbox-mark.svg" },
};

export const viewport = { themeColor: "#0E1116" };

// Runs before paint so a saved light theme never flashes dark.
const themeScript = `(function(){try{var t=localStorage.getItem("gb-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/Sora.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/Onest.woff2" as="font" type="font/woff2" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
