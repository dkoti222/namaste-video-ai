"use client";
import { Button, Shell } from "@/components/ui";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <Shell><section className="empty-state"><h1>Something went wrong.</h1><p className="lede">Try loading this page again.</p><Button onClick={reset}>Try again</Button></section></Shell>; }
