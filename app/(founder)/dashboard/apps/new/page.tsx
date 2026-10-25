import { SetupNotice } from "@/components/setup-notice";
import { ErrorBanner, TextArea, TextField, buttonClass, inputClass } from "@/components/ui";
import { isDatabaseConfigured } from "@/lib/env";
import { APP_CATEGORIES } from "@/schemas/app";
import { createAppAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewAppPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const { error } = await searchParams;
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add your app</h1>
        <p className="mt-1 text-slate-600">Start with the basics. Next you&apos;ll tell us who it&apos;s for and what you want customers to do.</p>
      </div>
      <ErrorBanner message={error} />
      <form action={createAppAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <TextField label="App name" name="name" required maxLength={120} />
        <TextField label="Website" name="websiteUrl" type="url" placeholder="https://" help="Where customers can see or try the app." />
        <label className="block text-sm">
          <span className="font-medium text-slate-800">Category<span className="text-red-600"> *</span></span>
          <select name="category" required defaultValue="" className={inputClass}>
            <option value="" disabled>Choose one</option>
            {APP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-800">Who buys it</span>
          <select name="businessType" defaultValue="" className={inputClass}>
            <option value="">Not sure yet</option>
            <option value="b2b">Businesses</option>
            <option value="b2c">Consumers</option>
            <option value="both">Both</option>
          </select>
        </label>
        <TextArea label="Short description" name="description" required maxLength={500} help="One or two sentences on what it does." />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Founder name" name="founderName" required maxLength={120} />
          <TextField label="Company name" name="companyName" required maxLength={120} />
        </div>
        <button className={buttonClass}>Continue</button>
      </form>
    </div>
  );
}
