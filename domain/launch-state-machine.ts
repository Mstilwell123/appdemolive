import { AppError } from "./errors";
import { EXCEPTION_STATUSES, LAUNCH_STATUSES, TERMINAL_STATUSES, type ActorKind, type LaunchStatus, type LaunchType } from "@/types/launch";

/**
 * Launch state machine (PRD §7, §58). This map is mirrored in the database table
 * public.launch_status_transitions, which enforces it again inside transition_launch().
 * tests/state-machine-parity.test.ts fails if the two drift apart.
 */
const F: ActorKind = "founder";
const O: ActorKind = "operator";
const S: ActorKind = "system";

const MAIN: Array<[LaunchStatus, LaunchStatus, ActorKind[]]> = [
  ["DRAFT", "INTAKE_IN_PROGRESS", [F, O]],
  ["INTAKE_IN_PROGRESS", "SUBMITTED", [F, O]],
  ["SUBMITTED", "QUALIFICATION_REVIEW", [O, S]],
  ["QUALIFICATION_REVIEW", "QUALIFIED", [O]],
  ["QUALIFICATION_REVIEW", "CHANGES_REQUIRED", [O]],
  ["CHANGES_REQUIRED", "INTAKE_IN_PROGRESS", [F, O]],
  ["CHANGES_REQUIRED", "SUBMITTED", [F, O]],
  ["QUALIFIED", "LAUNCH_TYPE_SELECTED", [F, O]],
  ["LAUNCH_TYPE_SELECTED", "PREPARATION", [O, S]],
  ["PREPARATION", "AWAITING_FOUNDER_APPROVAL", [O, S]],
  ["AWAITING_FOUNDER_APPROVAL", "SCHEDULED", [F]],
  ["AWAITING_FOUNDER_APPROVAL", "PREPARATION", [F, O]],
  ["SCHEDULED", "READY", [O]],
  ["READY", "LIVE", [O]],
  ["LIVE", "CAPTURE_PROCESSING", [O, S]],
  ["CAPTURE_PROCESSING", "CONTENT_GENERATION", [S, O]],
  ["CONTENT_GENERATION", "CONTENT_REVIEW", [S, O]],
  ["CONTENT_REVIEW", "AWAITING_CONTENT_APPROVAL", [O]],
  ["CONTENT_REVIEW", "CONTENT_GENERATION", [O]],
  ["AWAITING_CONTENT_APPROVAL", "DISTRIBUTION_READY", [F]],
  ["AWAITING_CONTENT_APPROVAL", "CONTENT_GENERATION", [F, O]],
  ["DISTRIBUTION_READY", "DISTRIBUTING", [O, S]],
  ["DISTRIBUTION_READY", "MEASURING", [O, S]],
  ["DISTRIBUTING", "MEASURING", [O, S]],
  ["MEASURING", "ANALYSIS", [O, S]],
  ["ANALYSIS", "EXPERIMENTING", [O]],
  ["ANALYSIS", "COMPLETED", [O]],
  ["EXPERIMENTING", "ANALYSIS", [O, S]],
  ["EXPERIMENTING", "COMPLETED", [O]],
];

/** Founders may cancel only before a launch is scheduled. */
const FOUNDER_CANCELLABLE: LaunchStatus[] = [
  "DRAFT",
  "INTAKE_IN_PROGRESS",
  "SUBMITTED",
  "QUALIFICATION_REVIEW",
  "QUALIFIED",
  "LAUNCH_TYPE_SELECTED",
];

function buildTransitions(): Map<string, ActorKind[]> {
  const map = new Map<string, ActorKind[]>();
  for (const [from, to, actors] of MAIN) map.set(`${from}>${to}`, actors);
  for (const from of LAUNCH_STATUSES) {
    if (TERMINAL_STATUSES.includes(from) || EXCEPTION_STATUSES.includes(from)) continue;
    map.set(`${from}>PAUSED`, [O]);
    map.set(`${from}>CANCELLED`, FOUNDER_CANCELLABLE.includes(from) ? [F, O] : [O]);
    map.set(`${from}>FAILED`, [O, S]);
  }
  map.set("CHANGES_REQUIRED>CANCELLED", [F, O]);
  map.set("PAUSED>CANCELLED", [O]);
  map.set("FAILED>CANCELLED", [O]);
  return map;
}

export const LAUNCH_TRANSITIONS: ReadonlyMap<string, readonly ActorKind[]> = buildTransitions();

export interface TransitionContext {
  launchType: LaunchType | null;
  scheduledAt: string | null;
  primaryGoalCount: number;
  /** C2: whether a successful payment exists. Required to leave LAUNCH_TYPE_SELECTED for PREPARATION. */
  paymentSucceeded?: boolean;
  /** For PAUSED/FAILED: the status the launch left, from launch_state_history. */
  resumeTo?: LaunchStatus | null;
}

export type TransitionCheck = { ok: true } | { ok: false; error: AppError };

/** Pure validation used by the server before calling the database, and by the UI to show allowed actions. */
export function canTransition(
  from: LaunchStatus,
  to: LaunchStatus,
  actor: ActorKind,
  ctx: TransitionContext,
): TransitionCheck {
  const fail = (code: ConstructorParameters<typeof AppError>[0], msg: string): TransitionCheck => ({
    ok: false,
    error: new AppError(code, msg),
  });

  if ((from === "PAUSED" || from === "FAILED") && to !== "CANCELLED") {
    if (!ctx.resumeTo || ctx.resumeTo !== to) {
      return fail("INVALID_STATE_TRANSITION", `${from} can only return to ${ctx.resumeTo ?? "its previous status"}`);
    }
    const mayResume = actor === "operator" || (from === "FAILED" && actor === "system");
    if (!mayResume) return fail("FORBIDDEN", `${actor} cannot resume a ${from.toLowerCase()} launch`);
  } else {
    const actors = LAUNCH_TRANSITIONS.get(`${from}>${to}`);
    if (!actors) return fail("INVALID_STATE_TRANSITION", `${from} to ${to} is not allowed`);
    if (!actors.includes(actor)) return fail("FORBIDDEN", `${actor} may not move ${from} to ${to}`);
  }

  if (to === "LAUNCH_TYPE_SELECTED" && !ctx.launchType) {
    return fail("VALIDATION_FAILED", "Choose a launch type first");
  }
  if (from === "LAUNCH_TYPE_SELECTED" && to === "PREPARATION" && !ctx.paymentSucceeded) {
    return fail("PAYMENT_REQUIRED", "The launch must be paid before preparation starts");
  }
  if (to === "READY" && ctx.primaryGoalCount !== 1) {
    return fail("VALIDATION_FAILED", "Exactly one primary goal is required before READY");
  }
  if (to === "READY" && !ctx.scheduledAt) {
    return fail("VALIDATION_FAILED", "The launch must be scheduled before READY");
  }
  return { ok: true };
}

/** Statuses an actor could move to next (ignoring guards), for UI display. */
export function nextStatuses(from: LaunchStatus, actor: ActorKind): LaunchStatus[] {
  const out: LaunchStatus[] = [];
  for (const [key, actors] of LAUNCH_TRANSITIONS) {
    const [f, t] = key.split(">") as [LaunchStatus, LaunchStatus];
    if (f === from && actors.includes(actor)) out.push(t);
  }
  return out;
}
