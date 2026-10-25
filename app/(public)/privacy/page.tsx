import type { Metadata } from "next";
import { LegalDraft } from "@/components/legal-draft";

export const metadata: Metadata = { title: "Privacy policy (draft)", robots: { index: false } };

export default function PrivacyPage() {
  return <LegalDraft title="Privacy policy" />;
}
