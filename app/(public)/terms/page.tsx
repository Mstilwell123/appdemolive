import type { Metadata } from "next";
import { LegalDraft } from "@/components/legal-draft";

export const metadata: Metadata = { title: "Terms of service (draft)", robots: { index: false } };

export default function TermsPage() {
  return <LegalDraft title="Terms of service" />;
}
