import type { Metadata } from "next";
import { PrivateShell } from "@/components/private-shell";
import { InstagramConnection } from "@/components/instagram-connection";
import { SettingsForm } from "@/components/settings-form";
import { getAuthServices } from "@/server/auth/auth";
import { requirePrivateSession } from "@/server/auth/dal";
import { enabledVoiceSamples } from "@/server/media/assets";
import { readInstagramConfig } from "@/server/instagram/config";
import { getConnection } from "@/server/instagram/service";
import { getPreferences } from "@/server/preferences";
import { availableVoices } from "@/server/voices";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ instagram?: string | string[] }> }) {
  const session = await requirePrivateSession("/settings");
  const { db } = await getAuthServices();
  const [preferences, samples, connection, query] = await Promise.all([getPreferences(db, session.user.id), enabledVoiceSamples(db), getConnection(db, session.user.id), searchParams]);
  const outcome = typeof query.instagram === "string" ? query.instagram : null;
  const voices = availableVoices().map((voice) => ({ ...voice, sampleUrl: samples.has(voice.preset) ? `/api/voices/${voice.preset}/sample` : null }));
  return (
    <PrivateShell user={session.user} current="settings">
      <SettingsForm
        email={session.user.email}
        initial={preferences}
        voices={voices}
        instagram={<InstagramConnection initial={connection} configured={readInstagramConfig() !== null} outcome={outcome} timeZone={preferences.timezone ?? "Asia/Kolkata"} />}
      />
    </PrivateShell>
  );
}
