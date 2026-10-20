import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RETURN_PATH, safeReturnPath, signInPath } from "../lib/return-path";

test("keeps same-origin relative paths including query and hash", () => {
  assert.equal(safeReturnPath("/videos"), "/videos");
  assert.equal(safeReturnPath("/projects/prj_abc?step=storyboard#scene-2"), "/projects/prj_abc?step=storyboard#scene-2");
});

test("rejects paths that could leave the app, loop to sign-in or reach the API", () => {
  for (const unsafe of [
    undefined, null, "", "videos", "https://evil.example/", "//evil.example", "/\\evil.example", "/%0d%0aLocation:x".replace("%0d", "\r"),
    "javascript:alert(1)", "/sign-in", "/sign-in/help", "/api/session", "/" + "a".repeat(600),
  ]) {
    assert.equal(safeReturnPath(unsafe), DEFAULT_RETURN_PATH, String(unsafe));
  }
});

test("builds sign-in links with a validated next path and optional expiry reason", () => {
  assert.equal(signInPath("/videos"), "/sign-in?next=%2Fvideos");
  assert.equal(signInPath("/videos", "expired"), "/sign-in?next=%2Fvideos&reason=expired");
  assert.equal(signInPath("https://evil.example"), "/sign-in?next=%2Fvideos");
});
