import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "./auth-forms";
import { Brand } from "./ui";

/** App chrome for signed-in pages. The page performs the session check and passes the user in. */
export function PrivateShell({ user, current = "videos", children }: { user: { email: string; name: string }; current?: "videos" | "settings"; children: ReactNode }) {
  return (
    <>
      <header className="site-header private-header">
        <Brand />
        <nav aria-label="Main" className="private-nav">
          <Link href="/videos" aria-current={current === "videos" ? "page" : undefined}>My videos</Link>
          <Link href="/settings" aria-current={current === "settings" ? "page" : undefined}>Settings</Link>
        </nav>
        <div className="account">
          <span className="account-email" title={user.email}>{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main id="main" className="container private-main">{children}</main>
    </>
  );
}
