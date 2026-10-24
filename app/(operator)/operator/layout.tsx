import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { getUserClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Staff check lives in the layout so non-staff never see any operator chrome (a plain 404). */
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <main className="mx-auto max-w-5xl p-10">{children}</main>;
  const supabase = (await getUserClient())!;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=/operator");
  const { data: isStaff } = await supabase.rpc("is_platform_staff");
  if (!isStaff) notFound();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/operator" className="font-bold">AppDemo operator</Link>
            <nav className="flex gap-5 text-sm text-slate-300">
              <Link href="/operator/qualifications" className="hover:text-white">Qualifications</Link>
            </nav>
          </div>
          <form action="/auth/signout" method="post"><button className="text-sm text-slate-300 hover:text-white">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
