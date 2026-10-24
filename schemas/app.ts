import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional().transform((v) => v ?? null);
const requiredText = (max: number, label: string) => z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^https?:\/\/\S+\.\S+/.test(v), "Enter a full web address starting with https://")
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const APP_CATEGORIES = ["SaaS", "Mobile app", "Web app", "AI app or agent", "Automation tool", "API or developer tool", "Plugin", "Other"] as const;
export const BUSINESS_TYPES = ["b2b", "b2c", "both"] as const;

export const newAppSchema = z.object({
  name: requiredText(120, "App name"),
  websiteUrl: optionalUrl,
  category: z.enum(APP_CATEGORIES, { message: "Choose a category" }),
  description: requiredText(500, "Short description"),
  businessType: z.enum(BUSINESS_TYPES).nullable().optional().transform((v) => v ?? null),
  founderName: requiredText(120, "Founder name"),
  companyName: requiredText(120, "Company name"),
});
export type NewAppInput = z.infer<typeof newAppSchema>;

/** Intake fields (§8). Saving allows blanks; submitting requires every minimum field. */
export const intakeDraftSchema = z.object({
  founderName: optionalText(120),
  companyName: optionalText(120),
  founderDescription: optionalText(2000),
  targetCustomer: optionalText(1000),
  problemSolved: optionalText(1000),
  desiredOutcome: optionalText(1000),
  desiredAction: optionalText(500),
});
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;

export const INTAKE_REQUIRED: Array<[keyof IntakeDraft, string]> = [
  ["founderName", "Founder name"],
  ["companyName", "Company name"],
  ["founderDescription", "Short description"],
  ["targetCustomer", "Intended customer"],
  ["problemSolved", "Problem solved"],
  ["desiredOutcome", "Desired outcome"],
  ["desiredAction", "Desired customer action"],
];

/** Names of required intake fields that are still empty. */
export function missingIntakeFields(d: IntakeDraft): string[] {
  return INTAKE_REQUIRED.filter(([k]) => !d[k]).map(([, label]) => label);
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "app";
}
