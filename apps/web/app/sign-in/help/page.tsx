import type { Metadata } from "next";
import { ActionLink } from "@/components/ui";
import { AuthLayout } from "@/components/auth-layout";

export const metadata: Metadata = { title: "Help signing in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInHelpPage({ searchParams }: { searchParams: SearchParams }) {
  const unavailable = (await searchParams).reason === "unavailable";

  return (
    <AuthLayout>
      <p className="tag">Account help</p>
      <h1 className="auth-title">{unavailable ? "Access unavailable" : "Contact your administrator to restore access"}</h1>
      {unavailable ? (
        <p className="muted">Your account can’t use NamasteVideo right now. Contact your administrator to restore access.</p>
      ) : (
        <p className="muted">Accounts are set up and recovered by your administrator. There is no self-service password reset.</p>
      )}
      <ul className="help-list">
        <li><strong>Forgot your password?</strong> Ask your administrator to reset it. Any existing sessions will be signed out.</li>
        <li><strong>Can’t sign in with the right password?</strong> Your access may have changed. Your administrator can check it.</li>
        <li><strong>Session ended?</strong> Videos already generating continue. Sign in again with the same account.</li>
      </ul>
      <p className="hint">For security, this page never confirms whether an email address has access.</p>
      <ActionLink href="/sign-in" variant="secondary">← Back to sign in</ActionLink>
    </AuthLayout>
  );
}
