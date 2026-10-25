/** PRD v1.4 R8: one evidence-linked experiment. Pure decision rules; no I/O. */

/** ASSUMPTION: each variant needs at least this many deduped clicks before any verdict. */
export const MIN_CLICKS_PER_VARIANT = 30;
/** ASSUMPTION: two-sided z ≥ 1.96 (~95%) on the click split, tested against an even 50/50 split. */
export const Z_THRESHOLD = 1.96;

export type Verdict =
  | { kind: "insufficient_data"; needed: number; text: string }
  | { kind: "no_clear_difference"; z: number; text: string }
  | { kind: "winner"; winner: "control" | "variant"; z: number; text: string };

/**
 * Compares deduped clicks on two tracked links shared over the same period. We only see clicks,
 * not impressions, so this asks "did one link draw clearly more clicks than chance would?".
 * Too little data never produces a winner.
 */
export function verdictFor(control: number, variant: number): Verdict {
  const low = Math.min(control, variant);
  if (low < MIN_CLICKS_PER_VARIANT) {
    const needed = MIN_CLICKS_PER_VARIANT - low;
    return { kind: "insufficient_data", needed, text: `Not enough data yet: each link needs at least ${MIN_CLICKS_PER_VARIANT} clicks (${needed} more on the quieter one). No winner is called.` };
  }
  const z = (variant - control) / Math.sqrt(control + variant);
  if (Math.abs(z) < Z_THRESHOLD) return { kind: "no_clear_difference", z, text: "Both links drew similar clicks. The difference could be chance, so neither wins." };
  const winner = z > 0 ? "variant" : "control";
  return { kind: "winner", winner, z, text: `The ${winner} link drew clearly more clicks (${Math.max(control, variant)} vs ${low}). This is clicks only; signups aren't connected yet.` };
}

/** Hypothesis status a verdict supports. Insufficient data keeps the test running. */
export function hypothesisStatusFor(v: Verdict): "testing" | "supported" | "refuted" | "inconclusive" {
  if (v.kind === "winner") return v.winner === "variant" ? "supported" : "refuted";
  return v.kind === "no_clear_difference" ? "inconclusive" : "testing";
}

export const evidenceSummary = (control: number, variant: number, v: Verdict) =>
  `Deduped tracked-link clicks: control ${control}, variant ${variant}. ${v.text}`;
