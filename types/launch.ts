export const LAUNCH_STATUSES = [
  "DRAFT",
  "INTAKE_IN_PROGRESS",
  "SUBMITTED",
  "QUALIFICATION_REVIEW",
  "QUALIFIED",
  "LAUNCH_TYPE_SELECTED",
  "PREPARATION",
  "AWAITING_FOUNDER_APPROVAL",
  "SCHEDULED",
  "READY",
  "LIVE",
  "CAPTURE_PROCESSING",
  "CONTENT_GENERATION",
  "CONTENT_REVIEW",
  "AWAITING_CONTENT_APPROVAL",
  "DISTRIBUTION_READY",
  "DISTRIBUTING",
  "MEASURING",
  "ANALYSIS",
  "EXPERIMENTING",
  "COMPLETED",
  "CHANGES_REQUIRED",
  "PAUSED",
  "CANCELLED",
  "FAILED",
] as const;
export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

export const EXCEPTION_STATUSES: readonly LaunchStatus[] = ["CHANGES_REQUIRED", "PAUSED", "CANCELLED", "FAILED"];
export const TERMINAL_STATUSES: readonly LaunchStatus[] = ["COMPLETED", "CANCELLED"];

export type ActorKind = "founder" | "operator" | "system";
export type LaunchType = "founder_demo" | "cohosted_launch";
export type OrgRole = "owner" | "admin" | "member";
export type GoalType = "purchase" | "trial" | "signup" | "lead" | "demo_booking" | "download" | "waitlist" | "custom";

export interface Launch {
  id: string;
  organization_id: string;
  app_id: string;
  app_version_id: string;
  launch_type: LaunchType | null;
  status: LaunchStatus;
  scheduled_at: string | null;
  primary_cta_id: string | null;
  created_at: string;
}

export type NextActionType =
  | "COMPLETE_INTAKE"
  | "RESOLVE_QUALIFICATION"
  | "SELECT_LAUNCH_TYPE"
  | "SET_PRIMARY_GOAL"
  | "COMPLETE_PAYMENT"
  | "APPROVE_STRATEGY"
  | "SCHEDULE"
  | "CONNECT_CTA"
  | "PREPARE_DEMO"
  | "GO_LIVE"
  | "APPROVE_CONTENT"
  | "DOWNLOAD_CONTENT"
  | "REVIEW_RESULTS"
  | "APPROVE_EXPERIMENT"
  | "NONE";

export interface NextAction {
  launchId: string | null;
  actionType: NextActionType;
  title: string;
  description: string;
  href: string | null;
  /** True when the launch cannot move forward until the founder does this. */
  blocking: boolean;
}
