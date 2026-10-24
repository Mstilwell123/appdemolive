"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { failTo, field } from "@/lib/action-errors";
import { intakeDraftSchema, newAppSchema } from "@/schemas/app";
import { goalSchema, launchDetailsSchema, launchTypeSchema, uuidSchema } from "@/schemas/launch";
import { createApp, createNextVersion, saveIntake, submitIntake, type VersionUrls } from "@/services/apps";
import { addGoal, cancelLaunch, chooseLaunchType, createLaunch, removeGoal, setPrimaryGoal, updateLaunchDetails } from "@/services/launch-setup";
import { approveLaunchPlan, requestPlanChanges } from "@/services/preparation";
import { z } from "zod";

const optUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^https?:\/\/\S+\.\S+/.test(v), "Enter full web addresses starting with https://");

export async function createAppAction(form: FormData) {
  let appId: string;
  try {
    const input = newAppSchema.parse({
      name: field(form, "name"),
      websiteUrl: field(form, "websiteUrl"),
      category: field(form, "category"),
      description: field(form, "description"),
      businessType: field(form, "businessType") || null,
      founderName: field(form, "founderName"),
      companyName: field(form, "companyName"),
    });
    appId = await createApp(input);
  } catch (e) {
    failTo("/dashboard/apps/new", e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/apps/${appId}/intake`);
}

function readIntake(form: FormData) {
  const draft = intakeDraftSchema.parse({
    founderName: field(form, "founderName"),
    companyName: field(form, "companyName"),
    founderDescription: field(form, "founderDescription"),
    targetCustomer: field(form, "targetCustomer"),
    problemSolved: field(form, "problemSolved"),
    desiredOutcome: field(form, "desiredOutcome"),
    desiredAction: field(form, "desiredAction"),
  });
  const urls: VersionUrls = {
    productUrl: optUrl.parse(field(form, "productUrl")),
    privacyUrl: optUrl.parse(field(form, "privacyUrl")),
    termsUrl: optUrl.parse(field(form, "termsUrl")),
    pricingUrl: optUrl.parse(field(form, "pricingUrl")),
  };
  return { draft, urls };
}

export async function saveIntakeAction(form: FormData) {
  const appId = field(form, "appId");
  const path = `/dashboard/apps/${appId}/intake`;
  const submit = field(form, "intent") === "submit";
  try {
    uuidSchema.parse(appId);
    const { draft, urls } = readIntake(form);
    if (submit) await submitIntake(appId, draft, urls);
    else await saveIntake(appId, draft, urls);
  } catch (e) {
    failTo(path, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(submit ? `/dashboard/apps/${appId}?submitted=1` : `${path}?saved=1`);
}

export async function createNextVersionAction(form: FormData) {
  const appId = field(form, "appId");
  try {
    uuidSchema.parse(appId);
    await createNextVersion(appId);
  } catch (e) {
    failTo(`/dashboard/apps/${appId}`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/apps/${appId}/intake`);
}

export async function createLaunchAction(form: FormData) {
  const appId = field(form, "appId");
  let launchId: string;
  try {
    uuidSchema.parse(appId);
    launchId = await createLaunch(appId);
  } catch (e) {
    failTo(field(form, "from") === "app" ? `/dashboard/apps/${appId}` : "/dashboard/launches/new", e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}`);
}

export async function updateLaunchDetailsAction(form: FormData) {
  const launchId = field(form, "launchId");
  const path = `/dashboard/launches/${launchId}#details`;
  try {
    uuidSchema.parse(launchId);
    await updateLaunchDetails(
      launchId,
      launchDetailsSchema.parse({
        objective: field(form, "objective"),
        audience: field(form, "audience"),
        ctaText: field(form, "ctaText"),
        dmKeyword: field(form, "dmKeyword"),
        trackedDestinationUrl: field(form, "trackedDestinationUrl"),
      }),
    );
  } catch (e) {
    failTo(path, e);
  }
  revalidatePath(`/dashboard/launches/${launchId}`);
  redirect(`/dashboard/launches/${launchId}?saved=details#details`);
}

export async function chooseLaunchTypeAction(form: FormData) {
  const launchId = field(form, "launchId");
  try {
    uuidSchema.parse(launchId);
    await chooseLaunchType(launchId, launchTypeSchema.parse(field(form, "launchType")));
  } catch (e) {
    failTo(`/dashboard/launches/${launchId}#format`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}#goals`);
}

export async function addGoalAction(form: FormData) {
  const launchId = field(form, "launchId");
  try {
    uuidSchema.parse(launchId);
    await addGoal(launchId, goalSchema.parse({ goalType: field(form, "goalType"), targetValue: field(form, "targetValue"), destinationUrl: field(form, "destinationUrl") }));
  } catch (e) {
    failTo(`/dashboard/launches/${launchId}#goals`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}#goals`);
}

export async function setPrimaryGoalAction(form: FormData) {
  const launchId = field(form, "launchId");
  try {
    await setPrimaryGoal(uuidSchema.parse(field(form, "goalId")));
  } catch (e) {
    failTo(`/dashboard/launches/${launchId}#goals`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}#goals`);
}

export async function removeGoalAction(form: FormData) {
  const launchId = field(form, "launchId");
  try {
    await removeGoal(uuidSchema.parse(field(form, "goalId")));
  } catch (e) {
    failTo(`/dashboard/launches/${launchId}#goals`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}#goals`);
}

export async function cancelLaunchAction(form: FormData) {
  const launchId = field(form, "launchId");
  try {
    uuidSchema.parse(launchId);
    await cancelLaunch(launchId);
  } catch (e) {
    failTo(`/dashboard/launches/${launchId}`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}`);
}

export async function approveLaunchPlanAction(form: FormData) {
  const launchId = field(form, "launchId");
  try {
    uuidSchema.parse(launchId);
    const version = z.coerce.number().int().positive().parse(field(form, "version"));
    await approveLaunchPlan(launchId, version);
  } catch (e) {
    failTo(`/dashboard/launches/${launchId}#plan`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}?saved=1#plan`);
}

export async function requestPlanChangesAction(form: FormData) {
  const launchId = field(form, "launchId");
  try {
    uuidSchema.parse(launchId);
    const notes = z.string().trim().min(5, "Tell us what to change (at least a few words).").max(2000, "Keep change requests under 2,000 characters.").parse(field(form, "notes"));
    await requestPlanChanges(launchId, notes);
  } catch (e) {
    failTo(`/dashboard/launches/${launchId}#plan`, e);
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/launches/${launchId}#plan`);
}
