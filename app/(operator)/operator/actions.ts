"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { failTo, field } from "@/lib/action-errors";
import { uuidSchema } from "@/schemas/launch";
import { areaReviewSchema, decisionSchema } from "@/schemas/qualification";
import { decideQualification, reviewArea } from "@/services/qualification";

export async function reviewAreaAction(form: FormData) {
  const id = field(form, "qualificationId");
  const path = `/operator/qualifications/${id}`;
  let area = "";
  try {
    uuidSchema.parse(id);
    const input = areaReviewSchema.parse({ area: field(form, "area"), status: field(form, "status"), notes: field(form, "notes") });
    area = input.area;
    await reviewArea(id, input.area, input.status, input.notes);
  } catch (e) {
    failTo(path, e);
  }
  revalidatePath(path);
  redirect(`${path}#${area}`);
}

export async function decideAction(form: FormData) {
  const id = field(form, "qualificationId");
  const path = `/operator/qualifications/${id}`;
  try {
    uuidSchema.parse(id);
    const input = decisionSchema.parse({ decision: field(form, "decision"), notes: field(form, "notes") });
    await decideQualification(id, input.decision, input.notes);
  } catch (e) {
    failTo(`${path}#decision`, e);
  }
  revalidatePath("/operator/qualifications");
  redirect(`/operator/qualifications?decided=${id}`);
}
