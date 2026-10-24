import { z } from "zod";

export const GOAL_TYPES = ["purchase", "trial", "signup", "lead", "demo_booking", "download", "waitlist", "custom"] as const;
export const GOAL_LABELS: Record<(typeof GOAL_TYPES)[number], string> = {
  purchase: "Purchase",
  trial: "Trial",
  signup: "Signup",
  lead: "Lead",
  demo_booking: "Demo booking",
  download: "Download",
  waitlist: "Waitlist",
  custom: "Custom",
};

const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v));
const url = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^https?:\/\/\S+\.\S+/.test(v), "Enter a full web address starting with https://");

export const uuidSchema = z.string().uuid();
export const launchTypeSchema = z.enum(["founder_demo", "cohosted_launch"]);

export const launchDetailsSchema = z.object({
  objective: text(1000),
  audience: text(1000),
  ctaText: text(280),
  dmKeyword: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toUpperCase()))
    .refine((v) => v === null || /^[A-Z0-9]{2,20}$/.test(v), "DM keyword must be 2–20 letters or numbers"),
  trackedDestinationUrl: url,
});

export const goalSchema = z.object({
  goalType: z.enum(GOAL_TYPES, { message: "Choose a goal type" }),
  targetValue: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Target must be a positive number"),
  destinationUrl: url,
});
