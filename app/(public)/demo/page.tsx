import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

// /demo is a compatible entry into the same experience as "/" (PRD v1.4 §117), not a competing page.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function DemoPage() {
  return <LandingPage />;
}
