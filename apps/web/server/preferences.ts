import type { Db } from "mongodb";
import { z } from "zod";
import { newId } from "./db/migrations";
import { canonicalTimezone, FALLBACK_TIMEZONE } from "../lib/timezones";
import { ApiError } from "./http";
import { DEFAULT_VOICE_PRESET, isVoiceAvailable } from "./voices";

// P08/P09 personal preferences (API_DESIGN.md section 5). A default voice change affects future projects only;
// existing drafts keep their own voice. Timezone is used later for scheduling (preference → browser → Asia/Kolkata).

/** revision 0 and timezone null mean nothing is saved yet; the UI then uses the browser timezone. */
export type PreferencesView = { revision: number; timezone: string | null; defaultVoicePreset: string };

export const preferencesBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    timezone: z.string().min(1).max(100).optional(),
    defaultVoicePreset: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((body) => body.timezone !== undefined || body.defaultVoicePreset !== undefined, { message: "Nothing to change." });

export async function getPreferences(db: Db, ownerId: string): Promise<PreferencesView> {
  const doc = await db.collection("preferences").findOne({ ownerId });
  if (!doc) return { revision: 0, timezone: null, defaultVoicePreset: DEFAULT_VOICE_PRESET };
  return { revision: Number(doc.revision), timezone: String(doc.timezone), defaultVoicePreset: String(doc.defaultVoicePreset) };
}

const conflict = (currentRevision: number) =>
  new ApiError(409, "REVISION_CONFLICT", "Your settings changed in another tab. Reload to see the latest.", { details: { currentRevision, reloadUrl: "/api/preferences" } });

export async function updatePreferences(db: Db, ownerId: string, body: z.infer<typeof preferencesBody>): Promise<PreferencesView> {
  const changes: { timezone?: string; defaultVoicePreset?: string } = {};
  if (body.timezone !== undefined) {
    const timezone = canonicalTimezone(body.timezone);
    if (!timezone) throw new ApiError(422, "INVALID_TIMEZONE", "Choose a timezone from the list.", { fieldErrors: [{ path: "timezone", code: "INVALID_TIMEZONE", message: "Unknown timezone." }] });
    changes.timezone = timezone;
  }
  if (body.defaultVoicePreset !== undefined) {
    if (!isVoiceAvailable(body.defaultVoicePreset)) throw new ApiError(422, "VOICE_UNAVAILABLE", "That voice isn’t available. Choose another voice.", { fieldErrors: [{ path: "defaultVoicePreset", code: "VOICE_UNAVAILABLE", message: "Voice unavailable." }] });
    changes.defaultVoicePreset = body.defaultVoicePreset;
  }
  const collection = db.collection("preferences");
  const now = new Date();

  if (body.expectedRevision === 0) {
    try {
      await collection.insertOne({
        _id: newId("prf") as never,
        schemaVersion: 1,
        ownerId,
        revision: 1,
        timezone: changes.timezone ?? FALLBACK_TIMEZONE,
        defaultVoicePreset: changes.defaultVoicePreset ?? DEFAULT_VOICE_PRESET,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw conflict((await getPreferences(db, ownerId)).revision);
      throw error;
    }
    return getPreferences(db, ownerId);
  }

  const updated = await collection.findOneAndUpdate(
    { ownerId, revision: body.expectedRevision },
    { $set: { ...changes, updatedAt: now }, $inc: { revision: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) throw conflict((await getPreferences(db, ownerId)).revision);
  return { revision: Number(updated.revision), timezone: String(updated.timezone), defaultVoicePreset: String(updated.defaultVoicePreset) };
}
