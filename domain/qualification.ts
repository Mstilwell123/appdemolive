import type { AreaStatus, Decision, QualificationArea } from "@/schemas/qualification";
import { QUALIFICATION_AREAS } from "@/schemas/qualification";

/** Mirrors qualification_decide() so the operator UI can explain why a decision isn't available yet. */
export function decisionProblem(areas: Record<QualificationArea, AreaStatus>, decision: Decision, notes: string | null): string | null {
  if (decision === "qualified") {
    const open = QUALIFICATION_AREAS.filter((a) => areas[a] !== "pass" && areas[a] !== "n_a");
    if (open.length) return "Every area must pass (or be not applicable) before you can qualify this version.";
  }
  if ((decision === "changes_required" || decision === "rejected") && !notes?.trim()) {
    return "Explain what needs to change so the founder can act on it.";
  }
  return null;
}

/** Launch status each decision moves a launch in QUALIFICATION_REVIEW to. */
export const DECISION_TO_STATUS = {
  qualified: "QUALIFIED",
  changes_required: "CHANGES_REQUIRED",
  rejected: "CANCELLED",
} as const;
