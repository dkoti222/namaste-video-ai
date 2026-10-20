import { randomBytes } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import type { CommandIdentity } from "../commands";
import type { Suggestion } from "../ai/gemini";
import { acceptJob, runJob, type JobContext } from "./core";

// Brainstorm (API_DESIGN.md S02): topic suggestions through the shared content-pipeline job lifecycle.

export const brainstormBody = z.strictObject({
  expectedDraftRevision: z.number().int().min(1),
  prompt: z
    .string()
    .refine((value) => value.trim().length > 0, { message: "Describe what you’d like ideas about." })
    .refine((value) => [...value].length <= 2000, { message: "Use at most 2,000 characters." }),
});

export type IdeasResult = { kind: "ideas"; suggestions: (Suggestion & { id: string })[] };
type Snapshot = { prompt: string; topic: string; audience: string; notes: string; draftRevision: number };

export function acceptBrainstorm(ctx: JobContext, identity: CommandIdentity, projectId: string, body: z.infer<typeof brainstormBody>) {
  return acceptJob(ctx, identity, projectId, {
    type: "brainstorm",
    stage: "planning",
    expectedDraftRevision: body.expectedDraftRevision,
    deadlineMs: 10 * 60_000,
    eventType: "job.brainstorm.requested",
    snapshot: (draft) => ({ prompt: body.prompt, topic: draft.topic, audience: draft.audience, notes: draft.notes }),
    userMessage: body.prompt,
  });
}

/** Executes a queued brainstorm job once. Safe to call repeatedly or concurrently. */
export function runBrainstorm(ctx: JobContext, jobId: string, generate: (input: Snapshot) => Promise<Suggestion[]>) {
  return runJob(ctx, jobId, "brainstorm", async (snapshot) => {
    const suggestions = await generate(snapshot as Snapshot);
    const result: IdeasResult = { kind: "ideas", suggestions: suggestions.map((s) => ({ id: `idea_${randomBytes(9).toString("base64url")}`, ...s })) };
    return async () => ({
      result,
      assistantText: `Here are ${result.suggestions.length} ideas:\n${result.suggestions.map((s, i) => `${i + 1}. ${s.topic} — ${s.angle}`).join("\n")}`,
    });
  });
}

export async function latestIdeas(db: Db, ownerId: string, projectId: string): Promise<IdeasResult | null> {
  const job = await db.collection("jobs").findOne(
    { ownerId, projectId, type: "brainstorm", state: "succeeded" },
    { sort: { createdAt: -1 }, projection: { result: 1 } },
  );
  return (job?.result as IdeasResult | undefined) ?? null;
}
