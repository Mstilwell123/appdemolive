"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CHANNELS, OWNERS, type Channel, type Owner } from "@/domain/promotion-plan";
import { failTo, field } from "@/lib/action-errors";
import { uuidSchema } from "@/schemas/launch";
import { confirmPost, generatePromotionPlan, recordPost, skipItem } from "@/services/promotion-plan";

const path = (id: string) => `/dashboard/launches/${id}/promote`;
async function run(form: FormData, fn: (id: string) => Promise<unknown>, done: string) {
  const id = field(form, "launchId");
  try { await fn(uuidSchema.parse(id)); } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(`${path(id)}?done=${done}`);
}
const itemId = (form: FormData) => uuidSchema.parse(field(form, "itemId"));

export const generatePlanAction = async (form: FormData) => run(form, (id) => generatePromotionPlan(id, {
  channels: form.getAll("channel").map(String).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c)).map((channel) => {
    const o = field(form, `owner_${channel}`);
    return { channel, owner: ((OWNERS as readonly string[]).includes(o) ? o : "founder") as Owner };
  }),
  startDate: field(form, "startDate"), timezone: field(form, "timezone"),
}), "planned");
export const recordPostAction = async (form: FormData) => run(form, (id) => recordPost(id, itemId(form), field(form, "postedUrl"), form.getAll("check").map(String)), "recorded");
export const confirmPostAction = async (form: FormData) => run(form, (id) => confirmPost(id, itemId(form)), "confirmed");
export const skipItemAction = async (form: FormData) => run(form, (id) => skipItem(id, itemId(form)), "skipped");
