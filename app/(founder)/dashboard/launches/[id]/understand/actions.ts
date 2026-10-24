"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { failTo, field } from "@/lib/action-errors";
import { uuidSchema } from "@/schemas/launch";
import { approveTruthSheet, saveTruthSheet, startTruthSheet } from "@/services/truth-sheet";
import type { TruthItem } from "@/domain/truth-sheet";

const path = (id: string) => `/dashboard/launches/${id}/understand`;

/** Reads rows named item.N.field; rows marked remove or left fully blank are dropped. */
async function readItems(form: FormData): Promise<TruthItem[]> {
  const n = Number(field(form, "rows")) || 0;
  const out: TruthItem[] = [];
  for (let i = 0; i < Math.min(n, 100); i++) {
    const g = (k: string) => field(form, `item.${i}.${k}`);
    if (g("remove") === "on" || !g("statement").trim()) continue;
    out.push({ category: g("category") as TruthItem["category"], kind: g("kind") as TruthItem["kind"], statement: g("statement"), evidenceUrl: g("evidenceUrl"), evidenceNote: g("evidenceNote") });
  }
  return out;
}

export async function startTruthSheetAction(form: FormData) {
  const id = field(form, "launchId");
  try { await startTruthSheet(uuidSchema.parse(id)); } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(path(id));
}

export async function saveTruthSheetAction(form: FormData) {
  const id = field(form, "launchId");
  try { await saveTruthSheet(uuidSchema.parse(id), await readItems(form)); } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(`${path(id)}?saved=1`);
}

export async function approveTruthSheetAction(form: FormData) {
  const id = field(form, "launchId");
  try { await approveTruthSheet(uuidSchema.parse(id)); } catch (e) { failTo(path(id), e); }
  revalidatePath(path(id));
  redirect(`${path(id)}?approved=1`);
}
