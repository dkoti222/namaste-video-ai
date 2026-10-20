// Operator command: put a narrator preview sample into the private R2 voice catalog.
// Usage: npm run voice-sample -- daniel-test            (generate with ElevenLabs if missing)
//        npm run voice-sample -- daniel-test --force    (regenerate; uses ElevenLabs characters)
//        npm run voice-sample -- daniel-test --import-local  (upload apps/web/voice-samples/<preset>.mp3; no ElevenLabs use)
import { closeDb, getDb } from "../server/db/client";
import { enabledVoiceSamples } from "../server/media/assets";
import { getObjectStore } from "../server/media/object-store";
import { generateSample, importLocalSample, SAMPLE_TEXT } from "../server/media/voice-samples";

async function main([preset = "daniel-test", flag]: string[]) {
  const store = getObjectStore();
  if (!store) throw new Error("R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).");
  const db = await getDb();
  if (flag === "--import-local") {
    const r = await importLocalSample(db, store, preset);
    console.log(`Imported local ${preset} sample into the catalog: ${r.bytes} bytes, sha256 ${r.sha256}.`);
    return;
  }
  if ((await enabledVoiceSamples(db)).has(preset) && flag !== "--force") {
    console.log(`A catalog sample for ${preset} already exists. Use --force to regenerate (uses ElevenLabs characters).`);
    return;
  }
  console.log(`Generating ${preset} sample (${[...SAMPLE_TEXT].length} characters of ElevenLabs quota)…`);
  const r = await generateSample(db, store, preset);
  console.log(`Stored ${r.bytes} bytes in the catalog, sha256 ${r.sha256}.`);
}

main(process.argv.slice(2))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
