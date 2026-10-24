/** PRD v1.4 R5 (§118.3): purposeful clip candidates, versions and two-stage approval. */
import type { TranscriptSegment } from "@/domain/recording";
import { unsupportedClaimsInCopy, type TruthItem } from "@/domain/truth-sheet";

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const PLACEMENTS = ["short_video", "feed_post", "landing_page", "email", "community"] as const;
export type Placement = (typeof PLACEMENTS)[number];
export const PLACEMENT_LABELS: Record<Placement, string> = {
  short_video: "Short video (Reels / Shorts / TikTok)", feed_post: "Feed post (LinkedIn / X)", landing_page: "Your landing page", email: "Email to your list", community: "Community post",
};
export const EXPORT_STATUSES = ["not_started", "rendering", "ready", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export const DECISIONS = ["approved", "revision_requested", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];
export const STAGES = ["internal", "founder"] as const;
export type Stage = (typeof STAGES)[number];

export interface ClipContent {
  viewer: string; purpose: string; hook: string; startMs: number; endMs: number; onScreen: string;
  caption: string; claims: string[]; cta: string; placement: Placement; aspect: Aspect; why: string;
}

/** ASSUMPTION: working service scope from §118.3 — about eight cuts, two rounds of minor revisions. */
export const TARGET_CLIPS = 8;
export const REVISION_ROUNDS = 2;
/** ASSUMPTION: useful clips run 8–90 seconds. */
export const MIN_CLIP_MS = 8_000;
export const MAX_CLIP_MS = 90_000;

/** Kinds of useful moments, in the order a buyer needs them. Each explains why the moment matters. */
const MOMENTS: Array<{ key: string; re: RegExp; purpose: string; why: string; placement: Placement; aspect: Aspect }> = [
  { key: "problem", re: /\b(problem|pain|frustrat|struggl|hate|tired of|waste|hard to|used to)\b/i, purpose: "Name the problem", why: "States the pain in the founder's words, so the right buyer recognizes themselves.", placement: "short_video", aspect: "9:16" },
  { key: "outcome", re: /\b(result|save[sd]?|minutes|hours|faster|instead|so you can|without)\b/i, purpose: "Show the outcome", why: "Connects the product to a concrete result a buyer cares about.", placement: "feed_post", aspect: "1:1" },
  { key: "walkthrough", re: /\b(click|here you|let me show|you can see|watch|this screen|dashboard|set up|create)\b/i, purpose: "Show it working", why: "Real product on screen, which is more convincing than a description.", placement: "short_video", aspect: "9:16" },
  { key: "use_case", re: /\b(for example|customer|imagine|one of our|a team|use case|when you)\b/i, purpose: "Realistic use case", why: "A concrete situation helps buyers picture using it.", placement: "landing_page", aspect: "16:9" },
  { key: "objection", re: /\b(but what|question|worried|concern|how much|does it work|secure|privacy|integrat)\w*/i, purpose: "Answer an objection", why: "Answers a question that stops people buying.", placement: "feed_post", aspect: "1:1" },
  { key: "cta", re: /\b(sign up|try it|get started|free|link|book|start today)\b/i, purpose: "Call to action", why: "A clear next step for people who are ready.", placement: "email", aspect: "16:9" },
];

function windowAround(segs: TranscriptSegment[], i: number) {
  let s = i, e = i;
  while (segs[e].endMs - segs[s].startMs < MIN_CLIP_MS && (s > 0 || e < segs.length - 1)) {
    if (e < segs.length - 1) e++; else s--;
  }
  while (e < segs.length - 1 && segs[e + 1].endMs - segs[s].startMs <= 45_000 && !/[.!?]$/.test(segs[e].text.trim())) e++;
  return { s, e };
}

/**
 * Proposes up to TARGET_CLIPS candidates from distinct useful moments. It does not pad to the
 * target: if the transcript only has five useful moments, it proposes five.
 */
export function proposeClips(segs: TranscriptSegment[], ctx: { audience: string; cta: string }): ClipContent[] {
  if (!segs.length) return [];
  const used: Array<[number, number]> = [];
  const out: ClipContent[] = [];
  const overlaps = (a: number, b: number) => used.some(([x, y]) => a < y && b > x);
  for (let round = 0; round < 2 && out.length < TARGET_CLIPS; round++) {
    for (const m of MOMENTS) {
      if (out.length >= TARGET_CLIPS) break;
      const i = segs.findIndex((g) => m.re.test(g.text) && !overlaps(g.startMs, g.endMs));
      if (i < 0) continue;
      const { s, e } = windowAround(segs, i);
      const startMs = segs[s].startMs, endMs = segs[e].endMs;
      if (overlaps(startMs, endMs) || endMs - startMs > MAX_CLIP_MS) continue;
      used.push([startMs, endMs]);
      const text = segs.slice(s, e + 1).map((g) => g.text.trim()).join(" ");
      out.push({
        viewer: ctx.audience || "Your likely buyer", purpose: m.purpose, why: m.why,
        hook: segs[i].text.trim().slice(0, 120), startMs, endMs, onScreen: "", caption: text.slice(0, 2200),
        claims: [], cta: ctx.cta, placement: m.placement, aspect: m.aspect,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export const clipCopy = (c: Pick<ClipContent, "hook" | "caption" | "cta" | "onScreen" | "claims">) =>
  [c.hook, c.onScreen, c.caption, c.cta, ...c.claims].join("\n");

export interface ReviewLike { stage: Stage; decision: Decision; version_id: string }
export interface VersionLike { id: string; export_status: ExportStatus }

/** A version's state is judged only from reviews of that exact version, so editing resets it. */
export function versionState(v: VersionLike, reviews: ReviewLike[]) {
  const mine = reviews.filter((r) => r.version_id === v.id);
  const last = (stage: Stage) => mine.filter((r) => r.stage === stage).at(-1)?.decision ?? null;
  const internal = last("internal"), founder = last("founder");
  const label = founder === "approved" && internal === "approved" ? "Approved"
    : founder === "rejected" || internal === "rejected" ? "Rejected"
    : founder === "revision_requested" || internal === "revision_requested" ? "Revision requested"
    : internal === "approved" ? "Waiting for your approval" : "In team review";
  return { internal, founder, approved: internal === "approved" && founder === "approved", label };
}

/** Reasons the founder can't approve this version yet. Empty means approvable. */
export function founderApprovalBlockers(v: VersionLike, internal: Decision | null, content: ClipContent, truth: TruthItem[] | null): string[] {
  const out: string[] = [];
  if (internal !== "approved") out.push("The team hasn't finished its review of this version.");
  if (v.export_status !== "ready") out.push("The video export isn't ready to watch yet.");
  if (!truth) out.push("Approve your truth sheet first.");
  else for (const c of unsupportedClaimsInCopy(clipCopy(content), truth)) out.push(`The copy mentions ${c.replace("_", " ")} without evidence on your truth sheet.`);
  return out;
}

export const revisionsUsed = (reviews: ReviewLike[]) => reviews.filter((r) => r.stage === "founder" && r.decision === "revision_requested").length;

export const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

const vttTime = (ms: number) => {
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
export const toVtt = (segs: TranscriptSegment[]) =>
  ["WEBVTT", ...segs.map((s, i) => `${i + 1}\n${vttTime(s.startMs)} --> ${vttTime(s.endMs)}\n${s.text.trim()}`)].join("\n\n") + "\n";
