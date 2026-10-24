// Local checkout preview (change request CR-1): order summary, mock checkout, scheduling,
// participants and confirmation. Pure logic only; nothing here writes data or takes money.
import { z } from "zod";
import type { LaunchType } from "@/types/launch";

export interface PreviewPrice { launchType: LaunchType; amount: number; currency: string; label: string }

/** What each format includes (PRD §12). Duration is the live show length in minutes. */
export const FORMAT_DETAILS: Record<LaunchType, { minutes: number; includes: string[]; staff: string[] }> = {
  founder_demo: {
    minutes: 15,
    includes: ["15-minute founder-led live presentation", "AppDemo preparation and run-of-show", "Moderation", "Recording",
      "About eight promotional cuts", "Analytics and conversion tracking"],
    staff: ["AppDemo moderator"],
  },
  cohosted_launch: {
    minutes: 30,
    includes: ["30-minute founder + professional co-host show", "Co-host asks questions as your prospective customer",
      "Background moderator", "AppDemo preparation and run-of-show", "Recording", "About eight promotional cuts", "Analytics and conversion tracking"],
    staff: ["AppDemo co-host", "AppDemo background moderator"],
  },
};

export function orderSummary(price: PreviewPrice) {
  // Tax and fees are not in the PRD; the preview charges the launch price only.
  return { lineLabel: price.label, subtotal: price.amount, total: price.amount, currency: price.currency };
}

function tzParts(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

export function isValidTimeZone(tz: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/**
 * Converts a wall-clock date and time in `timeZone` to a UTC instant.
 * Returns null when that wall time doesn't exist there (the hour skipped when clocks spring forward).
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm || !isValidTimeZone(timeZone)) return null;
  const [y, mo, d, h, mi] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = tzParts(guess, timeZone);
    const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - guess;
    guess = wall - offset;
  }
  const back = tzParts(guess, timeZone);
  if (back.y !== y || back.mo !== mo || back.d !== d || back.h !== h || back.mi !== mi) return null;
  return new Date(guess);
}

export function formatInZone(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
}

const email = z.string().trim().toLowerCase().email("Enter a valid email");
const name = (label: string) => z.string().trim().min(1, `${label} is required`).max(120);

export const scheduleSchema = z.object({ date: z.string(), time: z.string(), timeZone: z.string() });
export function validateSchedule(input: z.infer<typeof scheduleSchema>, now = new Date()): { at: Date } | { error: string } {
  if (!isValidTimeZone(input.timeZone)) return { error: "Choose a valid time zone" };
  if (!input.date || !input.time) return { error: "Choose a date and time" };
  const at = zonedTimeToUtc(input.date, input.time, input.timeZone);
  if (!at) return { error: "That time doesn't exist in this time zone (clocks change that night). Pick another time." };
  if (at.getTime() <= now.getTime()) return { error: "Choose a time in the future" };
  return { at };
}

export const MAX_GUESTS = 3; // ASSUMPTION A-CR1-2: up to three extra presenters in the preview.
export const participantsSchema = z.object({
  founderName: name("Your name"),
  founderEmail: email,
  guests: z.array(z.object({ name: name("Guest name"), email })).max(MAX_GUESTS, `Up to ${MAX_GUESTS} guests`),
  moderatorNotes: z.string().trim().max(1000, "Keep notes under 1,000 characters").default(""),
}).refine((v) => new Set([v.founderEmail, ...v.guests.map((g) => g.email)]).size === 1 + v.guests.length, {
  message: "Each person needs a different email", path: ["guests"],
});
export type Participants = z.infer<typeof participantsSchema>;

export function previewReference(seed: number) {
  return `PREVIEW-${seed.toString(36).toUpperCase().slice(-8)}`;
}
