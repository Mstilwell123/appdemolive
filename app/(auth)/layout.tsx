import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8">
        <Link href="/" className="text-lg font-bold">
          AppDemo<span className="text-indigo-600">.live</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
