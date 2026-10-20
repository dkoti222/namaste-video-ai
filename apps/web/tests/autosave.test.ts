// F07 autosave controller: debounce, in-flight edits, failure retention, conflicts and flush.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DraftAutosave, SaveConflict, type DraftFields, type SaveFn } from "../lib/autosave";

const blank: DraftFields = { topic: "", audience: "", notes: "", voicePreset: "daniel-test" };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A fake server: records calls; each call can be resolved, failed or conflicted by the test. */
function fakeServer() {
  let revision = 1;
  let fields = { ...blank };
  const calls: { expectedRevision: number; changes: Partial<DraftFields> }[] = [];
  let mode: "ok" | "fail" | "conflict" | "hold" = "ok";
  let release: (() => void) | null = null;
  const save: SaveFn = async (expectedRevision, changes) => {
    calls.push({ expectedRevision, changes });
    if (mode === "hold") await new Promise<void>((resolve) => (release = resolve));
    if (mode === "fail") throw new Error("Network unavailable");
    if (mode === "conflict" || expectedRevision !== revision) throw new SaveConflict(revision);
    fields = { ...fields, ...changes };
    revision += 1;
    return { revision, fields: { ...fields } };
  };
  return {
    save,
    calls,
    set mode(value: typeof mode) {
      mode = value;
    },
    release: () => release?.(),
    otherTab(changes: Partial<DraftFields>) {
      fields = { ...fields, ...changes };
      revision += 1;
      return { revision, fields: { ...fields } };
    },
    get state() {
      return { revision, fields };
    },
  };
}

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const server = fakeServer();
  const statuses: string[] = [];
  const autosave = new DraftAutosave({ revision: 1, fields: blank }, server.save, (s) => statuses.push(s.status));
  return { server, autosave, statuses };
}

test("edits are debounced for one second into a single save", async (t) => {
  const { server, autosave, statuses } = setup(t);
  autosave.edit({ topic: "Bin" });
  t.mock.timers.tick(500);
  autosave.edit({ topic: "Binary search" });
  autosave.edit({ audience: "Beginners" });
  t.mock.timers.tick(999);
  assert.equal(server.calls.length, 0);
  t.mock.timers.tick(1);
  await tick();
  assert.deepEqual(server.calls, [{ expectedRevision: 1, changes: { topic: "Binary search", audience: "Beginners" } }]);
  assert.equal(autosave.snapshot.status, "saved");
  assert.equal(autosave.snapshot.revision, 2);
  assert.ok(statuses.includes("unsaved") && statuses.includes("saving"));
});

test("edits typed while a save is in flight are saved next against the new revision", async (t) => {
  const { server, autosave } = setup(t);
  server.mode = "hold";
  autosave.edit({ topic: "First" });
  t.mock.timers.tick(1000);
  await tick();
  autosave.edit({ notes: "Typed during save" });
  assert.equal(autosave.snapshot.status, "saving");
  server.mode = "ok";
  server.release();
  const flushed = await autosave.flush();
  assert.equal(flushed, true);
  assert.deepEqual(server.calls.map((c) => c.expectedRevision), [1, 2]);
  assert.deepEqual(server.calls[1].changes, { notes: "Typed during save" });
  assert.deepEqual(autosave.snapshot.saved, { ...blank, topic: "First", notes: "Typed during save" });
  assert.equal(autosave.snapshot.status, "saved");
});

test("a failed save keeps local text, reports Save failed, and a later flush retries", async (t) => {
  const { server, autosave } = setup(t);
  server.mode = "fail";
  autosave.edit({ topic: "Keep me" });
  assert.equal(await autosave.flush(), false);
  assert.equal(autosave.snapshot.status, "failed");
  assert.equal(autosave.snapshot.local.topic, "Keep me");
  assert.equal(autosave.snapshot.error, "Network unavailable");
  server.mode = "ok";
  assert.equal(await autosave.flush(), true);
  assert.equal(server.state.fields.topic, "Keep me");
});

test("a conflict stops autosave until the user reapplies or reloads", async (t) => {
  const { server, autosave } = setup(t);
  const newer = server.otherTab({ topic: "From the other tab" });
  autosave.edit({ topic: "From this tab" });
  assert.equal(await autosave.flush(), false);
  assert.equal(autosave.snapshot.status, "conflict");
  assert.equal(autosave.snapshot.conflictRevision, 2);

  autosave.edit({ notes: "Still typing" });
  t.mock.timers.tick(5000);
  await tick();
  assert.equal(server.calls.length, 1, "nothing is sent while in conflict");
  assert.equal(autosave.snapshot.local.notes, "Still typing");

  assert.equal(await autosave.reapply(newer), true);
  assert.deepEqual(server.calls.at(-1), { expectedRevision: 2, changes: { topic: "From this tab", notes: "Still typing" } });
  assert.equal(server.state.fields.topic, "From this tab");

  const third = server.otherTab({ audience: "Changed again" });
  autosave.edit({ audience: "Mine" });
  await autosave.flush();
  autosave.reload(third);
  assert.deepEqual([autosave.snapshot.status, autosave.snapshot.local.audience], ["saved", "Changed again"]);
});

test("flush with nothing pending resolves immediately without a request", async (t) => {
  const { server, autosave } = setup(t);
  assert.equal(await autosave.flush(), true);
  assert.equal(server.calls.length, 0);
  autosave.edit({ topic: "x" });
  autosave.edit({ topic: "" });
  assert.equal(await autosave.flush(), true);
  assert.equal(server.calls.length, 0);
  assert.equal(autosave.snapshot.status, "saved");
});

test("the working storyboard is saved when its content changes and ignored when only the reference changes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const plan = { title: "Plan", scenes: [{ id: "a", narration: "First" }] };
  const calls: Partial<DraftFields>[] = [];
  let revision = 1;
  const autosave = new DraftAutosave({ revision, fields: { ...blank, editablePlan: plan } }, async (_r, changes) => {
    calls.push(changes);
    revision += 1;
    return { revision, fields: { ...blank, editablePlan: changes.editablePlan ?? plan } };
  });
  autosave.edit({ editablePlan: structuredClone(plan) });
  assert.equal(await autosave.flush(), true);
  assert.equal(calls.length, 0, "an identical copy is not a change");
  const edited = structuredClone(plan);
  edited.scenes[0].narration = "Edited";
  autosave.edit({ editablePlan: edited });
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(calls, [{ editablePlan: edited }]);
});
