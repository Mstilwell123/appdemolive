import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, LoadError, Panel, TextArea, TextField, buttonClass, secondaryButtonClass } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { load } from "@/lib/page-load";
import type { ProductAnalysis } from "@/integrations/ai/types";
import { getAppDetail } from "@/services/apps";
import { saveIntakeAction } from "../../../actions";

export const dynamic = "force-dynamic";

export default async function IntakePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const { id } = await params;
  const { error, saved } = await searchParams;
  const d = await load(`/dashboard/apps/${id}/intake`, () => getAppDetail(id));
  if (!d) return <LoadError what="your intake" />;
  const { app, latest, intake, understanding, latestQualification: q } = d;
  if (!intake || !latest) return <LoadError what="your intake" />;
  const locked = intake.status === "submitted";
  const analysis = understanding?.output as ProductAnalysis | undefined;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/dashboard/apps/${app.id}`} className="text-sm text-slate-500 hover:text-slate-800">{app.name}</Link>
        <h1 className="text-3xl font-bold">Tell us about {app.name}</h1>
        <p className="mt-1 text-slate-600">Your answers are the source of truth for your launch. We never overwrite them. Version {latest.version_label}.</p>
      </div>
      <ErrorBanner message={error} />
      {saved && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Saved.</div>}
      {q?.status === "changes_required" && !locked && q.review_notes && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">What our team asked you to change</p>
          <p className="mt-1 whitespace-pre-line">{q.review_notes}</p>
        </div>
      )}
      {locked && <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">Submitted. These answers are locked while we review this version.</div>}

      <form action={saveIntakeAction} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <input type="hidden" name="appId" value={app.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Founder name" name="founderName" defaultValue={intake.founder_name} required disabled={locked} maxLength={120} />
          <TextField label="Company name" name="companyName" defaultValue={intake.company_name} required disabled={locked} maxLength={120} />
        </div>
        <TextArea label="Short description" name="founderDescription" defaultValue={intake.founder_description} required disabled={locked} maxLength={2000} />
        <TextArea label="Intended customer" name="targetCustomer" defaultValue={intake.target_customer} required disabled={locked} maxLength={1000} help="Who is this for? Be specific." />
        <TextArea label="Problem solved" name="problemSolved" defaultValue={intake.problem_solved} required disabled={locked} maxLength={1000} />
        <TextArea label="Desired outcome" name="desiredOutcome" defaultValue={intake.desired_outcome} required disabled={locked} maxLength={1000} help="What changes for your customer after using it?" />
        <TextArea label="Desired customer action" name="desiredAction" defaultValue={intake.desired_action} required disabled={locked} maxLength={500} help="What should viewers do after the launch? For example, start a trial or book a demo." />
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium text-slate-800">Links for this version</legend>
          <TextField label="Product" name="productUrl" type="url" defaultValue={latest.product_url} disabled={locked} placeholder="https://" />
          <TextField label="Pricing" name="pricingUrl" type="url" defaultValue={latest.pricing_url} disabled={locked} placeholder="https://" />
          <TextField label="Privacy policy" name="privacyUrl" type="url" defaultValue={latest.privacy_url} disabled={locked} placeholder="https://" />
          <TextField label="Terms of service" name="termsUrl" type="url" defaultValue={latest.terms_url} disabled={locked} placeholder="https://" />
        </fieldset>
        {!locked && (
          <div className="flex gap-3">
            <button name="intent" value="save" className={secondaryButtonClass}>Save draft</button>
            <button name="intent" value="submit" className={buttonClass}>Submit for review</button>
          </div>
        )}
      </form>

      {analysis && (
        <Panel title="How AppDemo understands your product">
          {understanding?.source === "mock" && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Placeholder. Product analysis isn&apos;t connected yet, so this is sample text, not an assessment of your app.
            </p>
          )}
          <p className="text-sm text-slate-700">{analysis.summary}</p>
          {analysis.missingInformation?.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="font-medium">Information we still need</p>
              <ul className="ml-5 list-disc text-slate-700">{analysis.missingInformation.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
