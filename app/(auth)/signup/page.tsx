import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  return (
    <>
      <h1 className="mt-6 text-2xl font-bold">Launch your app</h1>
      <p className="mt-1 text-sm text-slate-600">Create your account. We&apos;ll email you a sign-in link.</p>
      <div className="mt-6">
        <AuthForm mode="signup" />
      </div>
      <p className="mt-6 text-sm text-slate-600">
        Already have an account? <Link href="/login" className="font-medium text-indigo-600">Log in</Link>
      </p>
    </>
  );
}
