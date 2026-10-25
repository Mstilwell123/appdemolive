import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { isDatabaseConfigured } from "@/lib/env";
import { operatorAccess } from "@/services/session";

export const dynamic = "force-dynamic";

/** Operator console home. Only Pragvance platform staff get past the server-side check. */
export default async function OperatorPage() {
  if (!isDatabaseConfigured()) return <SetupNotice />;
  const access = await operatorAccess();
  if (access === "signed_out") redirect("/login?next=/operator");
  if (access !== "ok") notFound(); // don't reveal the console exists

  return (
    <div>
      <h1 className="text-3xl font-bold">Operator console</h1>
      <ul className="mt-6 space-y-2">
        <li><Link href="/operator/qualifications" className="text-indigo-700 hover:underline">Qualification queue</Link></li>
      </ul>
    </div>
  );
}
