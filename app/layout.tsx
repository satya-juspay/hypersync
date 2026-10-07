import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

const themeInitScript = `(() => {
  let preference = "system";
  try {
    preference = localStorage.getItem("hypersync-theme") || "system";
  } catch {}
  document.documentElement.dataset.theme =
    preference === "light" || preference === "dark"
      ? preference
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
})();`;

export const metadata: Metadata = {
  title: "hyperSync",
  description: "Track and sync pull requests across release branches.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script
            id="theme-init"
            dangerouslySetInnerHTML={{ __html: themeInitScript }}
          />
        </head>
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
