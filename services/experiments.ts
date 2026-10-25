import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { experiment_results, experiment_variants, experiments, hypotheses, tracked_link_clicks, tracked_links } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { evidenceSummary, hypothesisStatusFor, verdictFor } from "@/domain/experiment";
import { dbErrorCode, type Db } from "@/lib/db";
import { authorizeLaunch } from "@/services/session";

export const experimentSchema = z.object({
  statement: z.string().trim().min(10, "Describe what you expect to happen").max(500),
  controlLinkId: z.string().uuid(),
  variantLinkId: z.string().uuid(),
}).refine((v) => v.controlLinkId !== v.variantLinkId, { message: "Pick two different links", path: ["variantLinkId"] });

const OPEN = ["completed", "cancelled"];
const linkIdOf = (c: unknown) => (c && typeof c === "object" && "tracked_link_id" in c ? String((c as { tracked_link_id: unknown }).tracked_link_id) : null);

async function openExperiment(db: Db, launchId: string) {
  const [exp] = await db.select().from(experiments).where(and(eq(experiments.launch_id, launchId), notInArray(experiments.status, OPEN)));
  return exp ?? null;
}

async function clicksSince(db: Db, launchId: string, linkIds: string[], since: string) {
  const rows = await db.select({ link: tracked_link_clicks.link_id, n: sql<number>`count(*)::int` }).from(tracked_link_clicks)
    .where(and(eq(tracked_link_clicks.launch_id, launchId), inArray(tracked_link_clicks.link_id, linkIds), gte(tracked_link_clicks.clicked_at, since)))
    .groupBy(tracked_link_clicks.link_id);
  return new Map(rows.map((r) => [r.link, r.n]));
}

export async function getImprove(launchId: string) {
  const { db } = await authorizeLaunch(launchId);
  const links = await db.select({ id: tracked_links.id, slug: tracked_links.slug, channel: tracked_links.channel, destination: tracked_links.destination_url })
    .from(tracked_links).where(eq(tracked_links.launch_id, launchId)).orderBy(tracked_links.created_at, tracked_links.slug);
  const [latest] = await db.select().from(experiments).where(eq(experiments.launch_id, launchId)).orderBy(desc(experiments.created_at)).limit(1);
  if (!latest) return { links, experiment: null };
  const [hyp] = latest.hypothesis_id ? await db.select().from(hypotheses).where(eq(hypotheses.id, latest.hypothesis_id)) : [];
  const variants = await db.select().from(experiment_variants).where(eq(experiment_variants.experiment_id, latest.id));
  const control = variants.find((v) => v.is_control);
  const variant = variants.find((v) => !v.is_control);
  const ids = [linkIdOf(control?.configuration), linkIdOf(variant?.configuration)].filter((x): x is string => !!x);
  const counts = await clicksSince(db, launchId, ids, latest.starts_at ?? latest.created_at);
  const c = counts.get(linkIdOf(control?.configuration) ?? "") ?? 0;
  const v = counts.get(linkIdOf(variant?.configuration) ?? "") ?? 0;
  return {
    links,
    experiment: { ...latest, hypothesis: hyp ?? null, control: { label: control?.label ?? "Control", clicks: c, linkId: linkIdOf(control?.configuration) }, variant: { label: variant?.label ?? "Variant", clicks: v, linkId: linkIdOf(variant?.configuration) }, verdict: verdictFor(c, v) },
  };
}

/** Starts the launch's one experiment, linked to a hypothesis and two of its own tracked links. Founder only. */
export async function startExperiment(launchId: string, input: z.input<typeof experimentSchema>) {
  const { db, launch, user } = await authorizeLaunch(launchId, ["founder"]);
  const p = experimentSchema.safeParse(input);
  if (!p.success) throw new AppError("VALIDATION_FAILED", p.error.issues[0]?.message ?? "Check the form");
  const { statement, controlLinkId, variantLinkId } = p.data;
  const links = await db.select({ id: tracked_links.id, channel: tracked_links.channel }).from(tracked_links)
    .where(and(eq(tracked_links.launch_id, launchId), inArray(tracked_links.id, [controlLinkId, variantLinkId])));
  if (links.length !== 2) throw new AppError("NOT_FOUND", "Pick two of this launch's tracked links");
  const org = launch.organization_id;
  try {
    return await db.transaction(async (tx) => {
      if (await openExperiment(tx, launchId)) throw new AppError("INVALID_STATE_TRANSITION", "This launch already has an experiment running");
      const [hyp] = await tx.insert(hypotheses).values({ organization_id: org, launch_id: launchId, statement, status: "testing", evidence_summary: "No results yet.", created_by: user.id }).returning({ id: hypotheses.id });
      const [exp] = await tx.insert(experiments).values({
        organization_id: org, launch_id: launchId, hypothesis_id: hyp.id, name: "Link A vs link B", independent_variable: "tracked_link",
        primary_metric: "tracked_link_clicks", status: "running", starts_at: new Date().toISOString(), created_by: user.id,
      }).returning({ id: experiments.id });
      await tx.insert(experiment_variants).values([
        { organization_id: org, experiment_id: exp.id, label: "Control", is_control: true, configuration: { tracked_link_id: controlLinkId }, created_by: user.id },
        { organization_id: org, experiment_id: exp.id, label: "Variant", is_control: false, configuration: { tracked_link_id: variantLinkId }, created_by: user.id },
      ]);
      return exp.id;
    });
  } catch (e) {
    if (dbErrorCode(e) === "23505") throw new AppError("INVALID_STATE_TRANSITION", "This launch already has an experiment running");
    throw e;
  }
}

/**
 * Records a results snapshot and updates the hypothesis evidence. With `finish`, the experiment
 * completes; finishing with insufficient data is refused so no winner is ever called on too little evidence.
 */
export async function recordResults(launchId: string, finish = false) {
  const { db, launch, user } = await authorizeLaunch(launchId, ["founder"]);
  const data = await getImprove(launchId);
  const exp = data.experiment;
  if (!exp || OPEN.includes(exp.status)) throw new AppError("INVALID_STATE_TRANSITION", "There's no running experiment");
  const { verdict, control, variant } = exp;
  if (finish && verdict.kind === "insufficient_data") throw new AppError("INVALID_STATE_TRANSITION", verdict.text);
  const variants = await db.select({ id: experiment_variants.id, is_control: experiment_variants.is_control }).from(experiment_variants).where(eq(experiment_variants.experiment_id, exp.id));
  const snapshot = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(experiment_results).values(variants.map((v) => {
      const clicks = v.is_control ? control.clicks : variant.clicks;
      return { organization_id: launch.organization_id, experiment_id: exp.id, variant_id: v.id, snapshot_id: snapshot, sample_size: clicks, metric_value: String(clicks), metadata: { metric: "tracked_link_clicks", verdict: verdict.kind }, created_by: user.id };
    }));
    if (exp.hypothesis_id) {
      await tx.update(hypotheses).set({ evidence_summary: evidenceSummary(control.clicks, variant.clicks, verdict), status: finish ? hypothesisStatusFor(verdict) : "testing" })
        .where(and(eq(hypotheses.id, exp.hypothesis_id), eq(hypotheses.launch_id, launchId)));
    }
    if (finish) await tx.update(experiments).set({ status: "completed", ends_at: new Date().toISOString() }).where(and(eq(experiments.id, exp.id), eq(experiments.launch_id, launchId)));
  });
  return verdict;
}

export async function cancelExperiment(launchId: string) {
  const { db } = await authorizeLaunch(launchId, ["founder"]);
  const exp = await openExperiment(db, launchId);
  if (!exp) throw new AppError("INVALID_STATE_TRANSITION", "There's no running experiment");
  await db.update(experiments).set({ status: "cancelled", ends_at: new Date().toISOString() }).where(and(eq(experiments.id, exp.id), eq(experiments.launch_id, launchId)));
  if (exp.hypothesis_id) await db.update(hypotheses).set({ status: "inconclusive" }).where(and(eq(hypotheses.id, exp.hypothesis_id), eq(hypotheses.launch_id, launchId)));
}
