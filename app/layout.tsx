import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AppDemo.live | Launch your software live",
  description:
    "You built the app. You show us how it works. We prepare the launch, help you demonstrate it, turn it into promotional content, and measure what creates customers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
