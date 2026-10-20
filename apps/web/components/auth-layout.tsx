import type { ReactNode } from "react";
import { Brand } from "./ui";

/** Centered authentication chrome: wordmark, compact panel, no product navigation. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <header className="auth-header"><Brand /></header>
      <main id="main" className="auth-main">
        <div className="auth-panel">{children}</div>
      </main>
    </div>
  );
}
