"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { failTo, field } from "@/lib/action-errors";
import { uuidSchema } from "@/schemas/launch";
import { createLinksForPlan } from "@/services/tracked-links";

export async function createLinksAction(form: FormData) {
  const id = field(form, "launchId");
  const path = `/dashboard/launches/${id}/measure`;
  try { await createLinksForPlan(uuidSchema.parse(id)); } catch (e) { failTo(path, e); }
  revalidatePath(path);
  redirect(`${path}?done=links`);
}
