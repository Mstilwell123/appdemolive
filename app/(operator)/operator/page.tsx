import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { getUserClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Operator console home. Only Pragvance platform staff get past the server-side check. */
export default async function OperatorPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const supabase = (await getUserClient())!;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=/operator");
  const { data: isStaff } = await supabase.rpc("is_platform_staff");
  if (!isStaff) notFound(); // don't reveal the console exists

  return (
    <div>
      <h1 className="text-3xl font-bold">Operator console</h1>
      <ul className="mt-6 space-y-2">
        <li><Link href="/operator/qualifications" className="text-indigo-700 hover:underline">Qualification queue</Link></li>
      </ul>
    </div>
  );
}
