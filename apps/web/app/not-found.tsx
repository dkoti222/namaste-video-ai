import { ActionLink, Shell } from "@/components/ui";
export default function NotFound() { return <Shell><section className="empty-state"><p className="eyebrow">404</p><h1>This page isn’t here.</h1><p className="lede">The link may be incorrect, or the page may have moved.</p><ActionLink href="/">Back to home</ActionLink></section></Shell>; }
