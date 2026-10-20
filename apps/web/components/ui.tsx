import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";
export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} type={type} className={`button button--${variant} ${className}`} />;
}
export function ActionLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: Variant }) {
  return <Link className={`button button--${variant}`} href={href}>{children}</Link>;
}
export function Brand() {
  return <Link className="brand" href="/" aria-label="NamasteVideo home"><span className="brand-mark" aria-hidden="true">▶</span><span>NamasteVideo<span className="accent">.ai</span></span></Link>;
}
export function Shell({ children }: { children: ReactNode }) {
  return <><header className="site-header"><Brand /><div className="header-actions"><span className="preview-label"><span aria-hidden="true" />Development preview</span><Link className="text-link" href="/sign-in">Sign in</Link></div></header><main id="main" className="container">{children}</main><footer className="site-footer"><span>NamasteVideo.ai</span><span>One idea. One clear story.</span></footer></>;
}
