import type { LaunchStatus, NextAction } from "@/types/launch";

/** Facts about a launch that the next-action engine needs beyond its status. */
export interface NextActionFacts {
  launchId: string;
  status: LaunchStatus;
  appId: string;
  scheduledAt: string | null;
  ctaConfigured: boolean;
  primaryGoalSet?: boolean;
  paymentSucceeded?: boolean;
  experimentAwaitingApproval: boolean;
}

/**
 * Pure next-action rules (PRD §57). getLaunchNextAction in services/launches.ts loads the
 * facts from the database and calls this.
 */
export function computeNextAction(f: NextActionFacts): NextAction {
  const base = `/dashboard/launches/${f.launchId}`;
  const act = (
    actionType: NextAction["actionType"],
    title: string,
    description: string,
    href: string | null,
    blocking: boolean,
  ): NextAction => ({ launchId: f.launchId, actionType, title, description, href, blocking });

  switch (f.status) {
    case "DRAFT":
    case "INTAKE_IN_PROGRESS":
      return act("COMPLETE_INTAKE", "Finish telling us about your app", "Answer a few questions so we can prepare your launch.", `/dashboard/apps/${f.appId}/intake`, true);
    case "SUBMITTED":
    case "QUALIFICATION_REVIEW":
      return act("NONE", "We're reviewing your app", "AppDemo is checking that your app is ready to launch. Nothing is needed from you right now.", base, false);
    case "CHANGES_REQUIRED":
      return act("RESOLVE_QUALIFICATION", "A few changes are needed", "Review what our team found, update your app details and resubmit.", `/dashboard/apps/${f.appId}/intake`, true);
    case "QUALIFIED":
      return act("SELECT_LAUNCH_TYPE", "Choose your launch format", "Pick Founder Demo or Co-Hosted Launch Show.", `${base}#format`, true);
    case "LAUNCH_TYPE_SELECTED":
      // ASSUMPTION A-P2-1: §57 has no goal or payment step; both are needed before preparation (C2).
      if (!f.primaryGoalSet) return act("SET_PRIMARY_GOAL", "Set your launch goal", "Tell us the one result that matters most, like signups or purchases.", `${base}#goals`, true);
      if (!f.paymentSucceeded) return act("COMPLETE_PAYMENT", "Pay for your launch", "Your launch preparation starts once payment is complete.", `${base}#payment`, true);
      return act("NONE", "Payment received", "We're starting your launch preparation.", base, false);
    case "PREPARATION":
      return act("NONE", "We're preparing your launch", "AppDemo is building your strategy and run-of-show.", base, false);
    case "AWAITING_FOUNDER_APPROVAL":
      return act("APPROVE_STRATEGY", "Approve your launch plan", "Review the strategy and run-of-show we prepared.", `${base}#plan`, true);
    case "SCHEDULED":
      if (!f.scheduledAt) return act("SCHEDULE", "Pick your launch time", "Choose when you'll go live.", base, true);
      if (!f.ctaConfigured) return act("CONNECT_CTA", "Set up your call to action", "Tell viewers what to do, like \"DM SCORE to get the app.\"", base, true);
      return act("PREPARE_DEMO", "Get ready to demo", "Walk through your run-of-show before launch day.", base, false);
    case "READY":
      return act("GO_LIVE", "You're ready to go live", "Join the studio at your scheduled time.", base, true);
    case "LIVE":
      return act("GO_LIVE", "You're live", "Your launch is on the air.", base, false);
    case "CAPTURE_PROCESSING":
    case "CONTENT_GENERATION":
    case "CONTENT_REVIEW":
      return act("NONE", "We're making your promo videos", "AppDemo is turning your presentation into promotional cuts.", base, false);
    case "AWAITING_CONTENT_APPROVAL":
      return act("APPROVE_CONTENT", "Approve your promo videos", "Review each cut, caption and call to action.", base, true);
    case "DISTRIBUTION_READY":
    case "DISTRIBUTING":
      return act("DOWNLOAD_CONTENT", "Download your Launch Content Pack", "Your approved videos, captions and posting suggestions are ready.", base, false);
    case "MEASURING":
    case "ANALYSIS":
      return act("REVIEW_RESULTS", "See how your launch is doing", "Results are coming in.", base, false);
    case "EXPERIMENTING":
      if (f.experimentAwaitingApproval) return act("APPROVE_EXPERIMENT", "Approve the next experiment", "We've proposed a test to improve results.", base, true);
      return act("REVIEW_RESULTS", "Your experiment is running", "We'll show you what we learn.", base, false);
    case "COMPLETED":
      return act("REVIEW_RESULTS", "Launch complete", "Review what worked and plan your next launch.", base, false);
    case "PAUSED":
      return act("NONE", "Your launch is paused", "Our team will be in touch about next steps.", base, false);
    case "FAILED":
      return act("NONE", "Something went wrong", "Our team has been alerted and is working on it.", base, false);
    case "CANCELLED":
      return act("NONE", "This launch was cancelled", "Start a new launch whenever you're ready.", "/dashboard/launches/new", false);
  }
}

/** Next action when the organization has no launch yet. */
export function noLaunchNextAction(hasApp: boolean): NextAction {
  return hasApp
    ? { launchId: null, actionType: "COMPLETE_INTAKE", title: "Start your first launch", description: "Pick your app and tell us what you want the launch to achieve.", href: "/dashboard/launches/new", blocking: true }
    : { launchId: null, actionType: "COMPLETE_INTAKE", title: "Add your app", description: "Tell us about the software you built. It takes a few minutes.", href: "/dashboard/apps/new", blocking: true };
}
