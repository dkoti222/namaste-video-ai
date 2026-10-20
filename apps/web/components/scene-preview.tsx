import { binaryTrace, type SceneV2 } from "@/lib/plan";

// Schematic, non-animated scene thumbnails (screens 08/20: "Schematic preview"). They show the planned visual's
// structure and on-screen text, not rendered video frames.

type Flow = { steps: { id: string; label: string }[] };
type Comparison = { left: { heading: string; points: string[] }; right: { heading: string; points: string[] } };
type Search = { values: number[]; target: number; step: number; mode: "setup" | "compare" | "result" };
type Labels = { labels: string[] };

function SearchPreview({ data }: { data: Search }) {
  let trace: ReturnType<typeof binaryTrace> = [];
  try {
    trace = binaryTrace(data.values, data.target);
  } catch {
    trace = [];
  }
  const step = trace[Math.min(data.step, trace.length - 1)];
  return (
    <div className="pv-search">
      <div className="pv-cells">
        {data.values.map((value, index) => {
          const inRange = data.mode === "setup" || !step || (index >= step.low && index <= step.high);
          const mid = data.mode !== "setup" && step?.mid === index;
          return (
            <span key={index} className={`pv-cell${inRange ? "" : " pv-cell--out"}${mid ? " pv-cell--mid" : ""}`}>
              {value}
            </span>
          );
        })}
      </div>
      <p className="pv-caption">
        Target {data.target}
        {data.mode === "setup" ? " · sorted list" : step ? ` · middle ${data.values[step.mid]} → ${step.outcome === "found" ? "found" : step.outcome === "right" ? "go right" : "go left"}` : ""}
      </p>
    </div>
  );
}

export function ScenePreview({ scene }: { scene: SceneV2 }) {
  const { component, data } = scene.visual;
  let body;
  if (component === "flow") {
    const steps = (data as Flow).steps ?? [];
    body = (
      <div className="pv-flow">
        {steps.map((step, index) => (
          <span key={step.id} className="pv-flow-item">
            {index > 0 && <i aria-hidden="true">→</i>}
            <span className={`pv-box${index === 0 ? " pv-box--accent" : ""}`}>{step.label || "…"}</span>
          </span>
        ))}
      </div>
    );
  } else if (component === "comparison") {
    const c = data as Comparison;
    body = (
      <div className="pv-compare">
        {[c.left, c.right].map((side, index) => (
          <div key={index} className={`pv-panel${index === 1 ? " pv-panel--accent" : ""}`}>
            <strong>{side?.heading || "…"}</strong>
            {(side?.points ?? []).map((point, i) => (
              <span key={i}>{point || "…"}</span>
            ))}
          </div>
        ))}
      </div>
    );
  } else if (component === "binary-search") {
    body = <SearchPreview data={data as Search} />;
  } else {
    const labels = (data as Labels).labels ?? [];
    body = (
      <div className="pv-labels">
        <div className="pv-wave" aria-hidden="true" />
        {labels.map((text, i) => (
          <span key={i} className="pv-box">{text || "…"}</span>
        ))}
      </div>
    );
  }
  return (
    <figure className="scene-preview" aria-label={`Schematic preview: ${component.replace("-", " ")}`}>
      {body}
      <figcaption>Schematic preview · {component.replace("-", " ")}</figcaption>
    </figure>
  );
}
