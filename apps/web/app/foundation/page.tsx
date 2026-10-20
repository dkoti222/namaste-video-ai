import type { Metadata } from "next";
import { ActionLink, Button, Shell } from "@/components/ui";

export const metadata: Metadata = { title: "UI foundation" };
const colors = [{ name: "Canvas", value: "#090909" }, { name: "Panel", value: "#151515" }, { name: "Accent", value: "#E58C33" }, { name: "Text", value: "#FAFAFA" }, { name: "Muted", value: "#A3A3A3" }, { name: "Divider", value: "#303030" }];

export default function Foundation() {
  return <Shell><section className="foundation"><p className="eyebrow">Cinema / UI foundation</p><h1>A consistent starting point.</h1><p className="lede">Shared colors, typography, controls, and feedback for the application. These are development specimens.</p>
    <section aria-labelledby="palette"><h2 id="palette">Color palette</h2><div className="swatches">{colors.map(c => <div className="swatch" key={c.name}><div style={{ background: c.value }} /><strong>{c.name}</strong><span>{c.value}</span></div>)}</div></section>
    <div className="specimen-grid"><section className="panel"><h2>Actions & inputs</h2><div className="actions"><ActionLink href="/">Back to home</ActionLink><Button variant="secondary" disabled>Not available yet</Button></div><label htmlFor="example-topic">Topic <span className="muted">· Sample input, not saved</span></label><textarea id="example-topic" placeholder="What would you like to explain?" maxLength={2000} rows={3} aria-describedby="input-help" /><p id="input-help" className="hint">Up to 2,000 characters. This page does not generate or store content.</p></section>
    <section className="panel"><h2>Feedback</h2><div className="notice">No videos yet. Your projects will appear here once project storage is built.</div><div className="notice notice--error"><strong>Save failed · example</strong><p>Changes haven’t reached the server. Keep this tab open and retry.</p></div><p className="hint">Sample states only—no save request has been sent.</p></section></div>
    <section className="panel type-specimen"><p className="eyebrow">Plus Jakarta Sans + Inter</p><h2>Every word has a visual.</h2><p>Headings carry the idea. Body text and controls keep the next step clear.</p></section>
  </section></Shell>;
}
