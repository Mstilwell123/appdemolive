"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { failTo, field } from "@/lib/action-errors";
import { uuidSchema } from "@/schemas/launch";
import { cancelExperiment, recordResults, startExperiment } from "@/services/experiments";

async function run(form: FormData, fn: (launchId: string) => Promise<unknown>, done: string) {
  const id = field(form, "launchId");
  const path = `/dashboard/launches/${id}/improve`;
  try { await fn(uuidSchema.parse(id)); } catch (e) { failTo(path, e); }
  revalidatePath(path);
  redirect(`${path}?done=${done}`);
}

export async function startExperimentAction(form: FormData) {
  await run(form, (id) => startExperiment(id, { statement: field(form, "statement"), controlLinkId: field(form, "controlLinkId"), variantLinkId: field(form, "variantLinkId") }), "started");
}
export async function recordResultsAction(form: FormData) {
  await run(form, (id) => recordResults(id, false), "recorded");
}
export async function finishExperimentAction(form: FormData) {
  await run(form, (id) => recordResults(id, true), "finished");
}
export async function cancelExperimentAction(form: FormData) {
  await run(form, (id) => cancelExperiment(id), "cancelled");
}
