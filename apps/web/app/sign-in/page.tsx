import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth-forms";
import { AuthLayout } from "@/components/auth-layout";
import { safeReturnPath } from "@/lib/return-path";
import { optionalSession } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeReturnPath(first(params.next));
  if (await optionalSession()) redirect(next);
  const expired = first(params.reason) === "expired";

  return (
    <AuthLayout>
      <p className="tag">Internal access</p>
      <h1 className="auth-title">Sign in</h1>
      {expired ? (
        <div className="notice" role="status">
          <strong>Your session has ended.</strong>
          <p>Your video generation continues. Sign in with the same account to return where you left off.</p>
        </div>
      ) : (
        <p className="muted auth-intro">Use the email and password your administrator set up for you.</p>
      )}
      <SignInForm next={next} />
      <p className="hint auth-note">Access is limited to approved team members. There is no public sign-up.</p>
    </AuthLayout>
  );
}
