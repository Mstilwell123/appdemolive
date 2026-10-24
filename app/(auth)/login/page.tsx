import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mt-6 text-2xl font-bold">Log in</h1>
      {error && <p className="mt-2 text-sm text-red-600">That sign-in link didn&apos;t work. Please request a new one.</p>}
      <div className="mt-6">
        <AuthForm mode="login" next={next} />
      </div>
      <p className="mt-6 text-sm text-slate-600">
        New here? <Link href="/signup" className="font-medium text-indigo-600">Create an account</Link>
      </p>
    </>
  );
}
