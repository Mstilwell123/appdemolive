/** PRD v1.4 R6 (§118.4): 14-day manual plan. Approve → Download → Post, then record the URL. */
import type { ClipContent, Placement } from "@/domain/content-pack";

export const CHANNELS = ["linkedin", "x", "instagram", "tiktok", "youtube_shorts", "email", "community", "landing_page"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  linkedin: "LinkedIn", x: "X", instagram: "Instagram", tiktok: "TikTok", youtube_shorts: "YouTube Shorts", email: "Email list", community: "Community / forum", landing_page: "Landing page",
};
export const OWNERS = ["founder", "appdemo", "partner"] as const;
export type Owner = (typeof OWNERS)[number];
export const OWNER_LABELS: Record<Owner, string> = { founder: "Your channel", appdemo: "AppDemo channel", partner: "Proposed partner" };
export const ITEM_STATUSES = ["planned", "posted_self_reported", "confirmed", "skipped"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
/** Never "Scheduled" or "Published": a planned item is "Ready to Post" (manual-first); a founder report is self-reported until confirmed. */
export const STATUS_LABELS: Record<ItemStatus, string> = {
  planned: "Ready to Post", posted_self_reported: "You reported posting", confirmed: "Post confirmed", skipped: "Skipped",
};

export const PLAN_DAYS = 14;
/** ASSUMPTION: a sustainable cadence for a founder posting by hand — eight posts on these days. */
export const POST_DAYS = [1, 2, 4, 5, 7, 9, 11, 13] as const;
/** ASSUMPTION: 09:00 in the founder's time zone unless they change it. */
export const DEFAULT_TIME = "09:00";

const FITS: Record<Placement, Channel[]> = {
  short_video: ["tiktok", "instagram", "youtube_shorts", "linkedin", "x"],
  feed_post: ["linkedin", "x", "instagram"],
  landing_page: ["landing_page", "linkedin"],
  email: ["email", "linkedin"],
  community: ["community", "x", "linkedin"],
};

export interface PlanChannel { channel: Channel; owner: Owner }
export interface PlanClip { versionId: string; position: number; version: number; content: ClipContent }
export interface PlanItemDraft {
  clipVersionId: string; day: number; plannedDate: string; plannedTime: string; channel: Channel; owner: Owner;
  audience: string; objective: string; postCopy: string; destinationUrl: string | null; responsible: Owner;
}

export const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * ASSUMPTION: until R7's tracked links exist, the destination is the CTA URL tagged with UTM
 * parameters naming the channel and clip version.
 */
export function taggedDestination(base: string | null, channel: Channel, clip: PlanClip): string | null {
  if (!base) return null;
  try {
    const u = new URL(base);
    u.searchParams.set("utm_source", channel);
    u.searchParams.set("utm_medium", "appdemo");
    u.searchParams.set("utm_campaign", "launch");
    u.searchParams.set("utm_content", `clip${clip.position}-v${clip.version}`);
    return u.toString();
  } catch { return null; }
}

/** Spreads approved clips over 14 days on channels that suit each clip, rotating so no channel repeats a day. */
export function generatePlan(clips: PlanClip[], channels: PlanChannel[], startDate: string, destination: string | null): PlanItemDraft[] {
  if (!clips.length || !channels.length) return [];
  const out: PlanItemDraft[] = [];
  const uses = new Map<Channel, number>();
  POST_DAYS.forEach((day, i) => {
    const clip = clips[i % clips.length];
    const fits = channels.filter((c) => FITS[clip.content.placement].includes(c.channel));
    const pool = fits.length ? fits : channels;
    const pick = [...pool].sort((a, b) => (uses.get(a.channel) ?? 0) - (uses.get(b.channel) ?? 0))[0];
    uses.set(pick.channel, (uses.get(pick.channel) ?? 0) + 1);
    out.push({
      clipVersionId: clip.versionId, day, plannedDate: addDays(startDate, day - 1), plannedTime: DEFAULT_TIME,
      channel: pick.channel, owner: pick.owner, audience: clip.content.viewer, objective: clip.content.purpose,
      postCopy: [clip.content.hook, clip.content.caption, clip.content.cta].filter(Boolean).join("\n\n"),
      destinationUrl: taggedDestination(destination, pick.channel, clip), responsible: pick.owner,
    });
  });
  return out;
}

/** Steps shown before the founder records a post. */
export const POSTING_CHECKLIST = [
  { id: "approved", text: "The clip version is approved" },
  { id: "downloaded", text: "I downloaded the video" },
  { id: "copy", text: "I pasted the post copy and the link" },
  { id: "account", text: "I'm posting from the right account" },
] as const;

/** A post can only be recorded for a clip version that is still the approved, current one. */
export function postingBlocker(item: { status: ItemStatus }, versionApprovedAndCurrent: boolean): string | null {
  if (item.status !== "planned") return "This item was already recorded.";
  if (!versionApprovedAndCurrent) return "This clip was edited or its approval changed. It's on hold until the new version is approved.";
  return null;
}

export function validPostUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}
