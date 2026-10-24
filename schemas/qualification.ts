import { z } from "zod";

export const QUALIFICATION_AREAS = ["functionality", "security", "privacy", "fraud", "brand_ip", "launch_readiness"] as const;
export type QualificationArea = (typeof QUALIFICATION_AREAS)[number];
export const AREA_LABELS: Record<QualificationArea, string> = {
  functionality: "Working functionality",
  security: "Security and malware",
  privacy: "Privacy",
  fraud: "Fraud and deceptive claims",
  brand_ip: "Brand, IP and impersonation",
  launch_readiness: "Launch readiness",
};
export const AREA_STATUSES = ["pending", "pass", "fail", "n_a"] as const;
export type AreaStatus = (typeof AREA_STATUSES)[number];
export const DECISIONS = ["qualified", "changes_required", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];

export const areaReviewSchema = z.object({
  area: z.enum(QUALIFICATION_AREAS),
  status: z.enum(AREA_STATUSES),
  notes: z.string().trim().max(4000).transform((v) => (v === "" ? null : v)),
});

export const decisionSchema = z.object({
  decision: z.enum(DECISIONS),
  notes: z.string().trim().max(4000).transform((v) => (v === "" ? null : v)),
});
