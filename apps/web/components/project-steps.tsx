"use client";

import Link from "next/link";

// Four-stage project stepper. Later stages become links only when they have real content.

const STEPS = [
  { key: "idea", label: "Idea", path: "" },
  { key: "storyboard", label: "Storyboard", path: "/storyboard" },
  { key: "video", label: "Video", path: "/video" },
  { key: "publish", label: "Publish", path: "/publish" },
] as const;

export function ProjectSteps({
  projectId,
  current,
  storyboardReady,
  videoReady = false,
  publishReady = false,
  beforeNavigate,
}: {
  projectId: string;
  current: "idea" | "storyboard" | "video" | "publish";
  storyboardReady: boolean;
  videoReady?: boolean;
  publishReady?: boolean;
  beforeNavigate?: () => Promise<boolean>;
}) {
  return (
    <ol className="stepper" aria-label="Video steps">
      {STEPS.map((step, index) => {
        const isCurrent = step.key === current;
        const enabled = !isCurrent && step.path !== null && (step.key === "idea" || (step.key === "storyboard" && storyboardReady) || (step.key === "video" && videoReady) || (step.key === "publish" && publishReady));
        const content = (
          <>
            <span>{String(index + 1).padStart(2, "0")}</span> {step.label}
          </>
        );
        return (
          <li key={step.key} className={isCurrent ? "step step--current" : "step"} aria-current={isCurrent ? "step" : undefined}>
            {enabled ? (
              <Link
                href={`/projects/${projectId}${step.path}`}
                className="step-link"
                onClick={async (event) => {
                  // Pending edits must reach the server before moving between steps.
                  if (!beforeNavigate) return;
                  event.preventDefault();
                  if (await beforeNavigate()) window.location.assign(`/projects/${projectId}${step.path}`);
                }}
              >
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}
