/**
 * PRD v1.4 §118.1: the product truth sheet. It separates confirmed facts, founder-reported claims,
 * missing information and suggestions. Offer-type claims (pricing, free trial, performance,
 * testimonial, guarantee) need recorded evidence; an unsupported offer blocks approval of any
 * promotional copy that uses it.
 */
export const TRUTH_CATEGORIES = [
  "product", "buyer", "problem", "benefit", "offer", "pricing", "free_trial", "performance_claim",
  "testimonial", "guarantee", "limitation", "cta", "channel",
] as const;
export type TruthCategory = (typeof TRUTH_CATEGORIES)[number];
export const TRUTH_KINDS = ["confirmed", "founder_reported", "missing", "suggestion"] as const;
export type TruthKind = (typeof TRUTH_KINDS)[number];

/** Categories whose statements are offers or claims and therefore need evidence. */
export const EVIDENCE_REQUIRED: readonly TruthCategory[] = ["pricing", "free_trial", "performance_claim", "testimonial", "guarantee"];
/** Every truth sheet must say something (or record what's missing) about these. */
export const REQUIRED_CATEGORIES: readonly TruthCategory[] = ["product", "buyer", "problem", "benefit", "pricing", "cta"];

export const CATEGORY_LABELS: Record<TruthCategory, string> = {
  product: "What it does", buyer: "Who it's for", problem: "Problem", benefit: "Demonstrated benefit", offer: "Offer",
  pricing: "Pricing", free_trial: "Free trial", performance_claim: "Performance claim", testimonial: "Testimonial",
  guarantee: "Guarantee", limitation: "Known limitation", cta: "Primary call to action", channel: "Where prospects are",
};
export const KIND_LABELS: Record<TruthKind, string> = {
  confirmed: "Confirmed", founder_reported: "Founder-reported", missing: "Missing", suggestion: "Suggestion",
};

export interface TruthItem {
  category: TruthCategory;
  kind: TruthKind;
  statement: string;
  evidenceUrl?: string | null;
  evidenceNote?: string | null;
}

export const hasEvidence = (i: TruthItem) => Boolean((i.evidenceUrl ?? "").trim() || (i.evidenceNote ?? "").trim());
export const needsEvidence = (i: TruthItem) => EVIDENCE_REQUIRED.includes(i.category) && i.kind !== "missing" && i.kind !== "suggestion";
/** Offer-type claims stated as fact (confirmed or founder-reported) without evidence. */
export const unsupportedClaims = (items: TruthItem[]) => items.filter((i) => needsEvidence(i) && !hasEvidence(i));

export interface IntakeFacts {
  appName: string;
  websiteUrl: string | null;
  founderDescription: string | null;
  targetCustomer: string | null;
  problemSolved: string | null;
  desiredOutcome: string | null;
  pricingSummary: string | null;
  primaryCta: string | null;
}
export interface AnalysisHints {
  differentiators?: string[];
  claimsRequiringVerification?: string[];
  missingInformation?: string[];
}

const TRIAL = /free[\s-]*trial|\btry (it )?free\b/i;

/** Builds the first draft from the founder's intake (founder-reported) and the AI analysis (suggestions only). */
export function draftTruthSheet(intake: IntakeFacts, analysis: AnalysisHints | null): TruthItem[] {
  const items: TruthItem[] = [];
  const reported = (category: TruthCategory, v: string | null) => {
    if (v && v.trim()) items.push({ category, kind: "founder_reported", statement: v.trim().slice(0, 1000) });
  };
  reported("product", intake.founderDescription);
  reported("buyer", intake.targetCustomer);
  reported("problem", intake.problemSolved);
  reported("benefit", intake.desiredOutcome);
  reported("pricing", intake.pricingSummary);
  reported("cta", intake.primaryCta);
  if (intake.pricingSummary && TRIAL.test(intake.pricingSummary)) {
    items.push({ category: "free_trial", kind: "founder_reported", statement: intake.pricingSummary.trim().slice(0, 1000) });
  }
  for (const d of analysis?.differentiators ?? []) items.push({ category: "benefit", kind: "suggestion", statement: d });
  for (const c of analysis?.claimsRequiringVerification ?? []) items.push({ category: "performance_claim", kind: "suggestion", statement: `Check before using: ${c}` });
  for (const m of analysis?.missingInformation ?? []) items.push({ category: "limitation", kind: "missing", statement: m });
  for (const c of REQUIRED_CATEGORIES) {
    if (!items.some((i) => i.category === c && i.kind !== "suggestion")) {
      items.push({ category: c, kind: "missing", statement: `${CATEGORY_LABELS[c]} not provided yet.` });
    }
  }
  return items;
}

/** Reasons the founder can't approve the truth sheet yet. Empty means it can be approved. */
export function approvalBlockers(items: TruthItem[]): string[] {
  const out: string[] = [];
  for (const c of REQUIRED_CATEGORIES) {
    if (!items.some((i) => i.category === c && (i.kind === "confirmed" || i.kind === "founder_reported"))) {
      out.push(`Add ${CATEGORY_LABELS[c].toLowerCase()}.`);
    }
  }
  for (const i of unsupportedClaims(items)) {
    out.push(`Add evidence for the ${CATEGORY_LABELS[i.category].toLowerCase()} claim "${i.statement.slice(0, 80)}", or mark it missing.`);
  }
  return out;
}

const COPY_PATTERNS: Array<{ category: TruthCategory; re: RegExp }> = [
  { category: "free_trial", re: TRIAL },
  { category: "guarantee", re: /guarantee|money[\s-]*back|risk[\s-]*free/i },
  { category: "pricing", re: /\$\s?\d|\bper month\b|\/mo\b|\bdiscount\b|\d+\s?% off/i },
  { category: "performance_claim", re: /\b\d+(\.\d+)?\s?(%|x)\s|\bfaster\b|\bsave[sd]? \d/i },
  { category: "testimonial", re: /[“"][^”"]{10,}[”"]\s?[-–—]\s?\w/ },
];

/**
 * Which offer claims in a piece of promotional copy the approved truth sheet doesn't support with
 * evidence. Any result blocks approval of that copy (§118.1).
 */
export function unsupportedClaimsInCopy(copy: string, items: TruthItem[]): TruthCategory[] {
  const out: TruthCategory[] = [];
  for (const { category, re } of COPY_PATTERNS) {
    if (!re.test(copy)) continue;
    const supported = items.some((i) => i.category === category && (i.kind === "confirmed" || i.kind === "founder_reported") && hasEvidence(i));
    if (!supported) out.push(category);
  }
  return out;
}
