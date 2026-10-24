import type { LaunchStatus } from "@/types/launch";

/** Founder-facing stages. Many internal statuses collapse into one stage the founder understands. */
export const FOUNDER_STAGES = ["Intake", "Review", "Preparation", "Scheduled", "Live", "Content", "Results"] as const;
export type FounderStage = (typeof FOUNDER_STAGES)[number];

interface StageInfo {
  stage: FounderStage | null; // null for exception statuses shown on their own
  label: string;
  /** What AppDemo is doing right now, or null when the launch is waiting on the founder. */
  appDemoDoing: string | null;
  /** What happens after this stage, in plain words. */
  whatsNext: string;
}

const INFO: Record<LaunchStatus, StageInfo> = {
  DRAFT: { stage: "Intake", label: "Getting started", appDemoDoing: null, whatsNext: "Once you submit your app details, we review whether it's ready to launch." },
  INTAKE_IN_PROGRESS: { stage: "Intake", label: "Telling us about your app", appDemoDoing: null, whatsNext: "Once you submit your app details, we review whether it's ready to launch." },
  SUBMITTED: { stage: "Review", label: "Submitted", appDemoDoing: "Queuing your app for review.", whatsNext: "We check that your app works and is a good fit, then you choose your launch format." },
  QUALIFICATION_REVIEW: { stage: "Review", label: "In review", appDemoDoing: "Reviewing your app to confirm it's ready to launch.", whatsNext: "If it's ready, you choose your launch format. If not, we tell you exactly what to change." },
  CHANGES_REQUIRED: { stage: null, label: "Changes needed", appDemoDoing: null, whatsNext: "After you make the changes, we review your app again." },
  QUALIFIED: { stage: "Review", label: "Approved to launch", appDemoDoing: null, whatsNext: "After you choose a format, we prepare your strategy and run-of-show." },
  LAUNCH_TYPE_SELECTED: { stage: "Preparation", label: "Format chosen", appDemoDoing: null, whatsNext: "Next we prepare your strategy and run-of-show." },
  PREPARATION: { stage: "Preparation", label: "Preparing your launch", appDemoDoing: "Building your launch strategy, run-of-show and customer questions.", whatsNext: "You review and approve the plan." },
  AWAITING_FOUNDER_APPROVAL: { stage: "Preparation", label: "Plan ready for you", appDemoDoing: null, whatsNext: "Once you approve, we lock in your launch time." },
  SCHEDULED: { stage: "Scheduled", label: "Scheduled", appDemoDoing: "Getting the studio and your call to action ready.", whatsNext: "On launch day you join the studio and go live." },
  READY: { stage: "Scheduled", label: "Ready to go live", appDemoDoing: "Standing by for your launch.", whatsNext: "You go live at your scheduled time." },
  LIVE: { stage: "Live", label: "Live now", appDemoDoing: "Running your launch and moderating viewer questions.", whatsNext: "After the launch, we turn the recording into promotional videos." },
  CAPTURE_PROCESSING: { stage: "Content", label: "Processing your recording", appDemoDoing: "Processing and transcribing your recording.", whatsNext: "We cut about eight promotional videos for you to approve." },
  CONTENT_GENERATION: { stage: "Content", label: "Making your videos", appDemoDoing: "Cutting your promotional videos.", whatsNext: "Our team checks the videos, then you approve them." },
  CONTENT_REVIEW: { stage: "Content", label: "Checking your videos", appDemoDoing: "Reviewing each video before it reaches you.", whatsNext: "You approve your videos." },
  AWAITING_CONTENT_APPROVAL: { stage: "Content", label: "Videos ready for you", appDemoDoing: null, whatsNext: "After you approve, your Launch Content Pack is ready to download and post." },
  DISTRIBUTION_READY: { stage: "Content", label: "Content pack ready", appDemoDoing: "Preparing tracked links for your posts.", whatsNext: "We start measuring clicks, signups and sales." },
  DISTRIBUTING: { stage: "Content", label: "Content going out", appDemoDoing: "Distributing approved content.", whatsNext: "We start measuring clicks, signups and sales." },
  MEASURING: { stage: "Results", label: "Measuring results", appDemoDoing: "Collecting clicks, signups and sales from your launch.", whatsNext: "We analyze what worked and propose the next experiment." },
  ANALYSIS: { stage: "Results", label: "Analyzing results", appDemoDoing: "Analyzing which messages and channels brought in customers.", whatsNext: "We propose an experiment to improve results." },
  EXPERIMENTING: { stage: "Results", label: "Running an experiment", appDemoDoing: "Testing a change to improve your results.", whatsNext: "We report what we learned and wrap up your launch." },
  COMPLETED: { stage: "Results", label: "Complete", appDemoDoing: null, whatsNext: "Start your next launch whenever you're ready." },
  PAUSED: { stage: null, label: "Paused", appDemoDoing: "Our team is reviewing your launch.", whatsNext: "We'll contact you before anything resumes." },
  FAILED: { stage: null, label: "Needs attention", appDemoDoing: "Our team has been alerted and is fixing the problem.", whatsNext: "We'll contact you with next steps." },
  CANCELLED: { stage: null, label: "Cancelled", appDemoDoing: null, whatsNext: "Start a new launch whenever you're ready." },
};

export function stageInfo(status: LaunchStatus): StageInfo {
  return INFO[status];
}

/** Statuses at or after which launch results can exist. */
export function hasResultsStage(status: LaunchStatus): boolean {
  return INFO[status].stage === "Results";
}
