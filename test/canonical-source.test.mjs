// Source-of-truth architecture guard.
//
// crewboard-template.html is the ONE canonical, hand-edited, tracked source for
// all of CrewBoard's application code. crewboard.html (private, git-ignored)
// and index.html (public, tracked) are both BUILD OUTPUTS produced from it by
// scripts/build-crewboard.mjs — never hand-edited directly. See CLAUDE.md.
//
// This file exists so that architecture silently rotting (someone hand-edits
// an output again, or the canonical file goes missing/corrupt) fails LOUDLY
// here instead of showing up later as unexplained drift between the private
// app and everything else.
//
// Run:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const CANONICAL = join(repo, "crewboard-template.html");
const PUBLIC_OUT = join(repo, "index.html");
const PRIVATE_OUT = join(repo, "crewboard.html");
const PRIVATE_DATA = join(repo, "crewboard-data.private.json");
const BUILD_SCRIPT = join(repo, "scripts", "build-crewboard.mjs");

test("the canonical source (crewboard-template.html) exists and looks like the real app", () => {
  assert.ok(existsSync(CANONICAL), `canonical source is MISSING: ${CANONICAL} — nothing can be built without it`);
  const html = readFileSync(CANONICAL, "utf8");
  assert.ok(html.length > 300000, `canonical source is suspiciously small (${html.length} bytes) — looks truncated/placeholder`);
  assert.match(html, /<nav class="tabs">/, "canonical source is missing the app shell — does not look like the real app");
  // Deep markers from several build phases, so a partial/rolled-back file fails
  // loudly instead of silently shipping a stale subset.
  for (const marker of ["computeCalendarDiff", "applyCalendarSyncDelta", "_calSeenActiveLineages", "profileFromStore", "resolveLegBlock"]) {
    assert.match(html, new RegExp(`function ${marker}\\(`), `canonical source is missing "${marker}" — looks like an older/partial build`);
  }
});

test("the canonical source carries the CANONICAL SOURCE banner (marks it, not an output, as the one to hand-edit)", () => {
  const html = readFileSync(CANONICAL, "utf8");
  assert.match(html, /<!-- CANONICAL SOURCE/);
});

test("index.html (public build output) exists and is byte-identical to the canonical source", () => {
  assert.ok(existsSync(PUBLIC_OUT), `${PUBLIC_OUT} is missing — run: node scripts/build-crewboard.mjs --public`);
  assert.ok(
    readFileSync(CANONICAL).equals(readFileSync(PUBLIC_OUT)),
    "index.html has drifted from crewboard-template.html — someone likely hand-edited one of them; regenerate with the build script instead"
  );
});

test("build-crewboard.mjs --check reports both outputs up to date", () => {
  try {
    execFileSync(process.execPath, [BUILD_SCRIPT, "--check"], { cwd: repo, stdio: "pipe" });
  } catch (e) {
    assert.fail(`build-crewboard.mjs --check failed:\n${e.stdout}${e.stderr}`);
  }
});

test("crewboard.html (private build output, git-ignored) contains no TEMPLATE: placeholders when built", (t) => {
  if (!existsSync(PRIVATE_OUT)) { t.skip("crewboard.html not built locally — nothing to check (expected on a fresh clone)"); return; }
  const html = readFileSync(PRIVATE_OUT, "utf8");
  assert.equal(/TEMPLATE:/.test(html), false, "crewboard.html still contains TEMPLATE: placeholders — the private build did not inject real data");
  assert.match(html, /<!-- GENERATED/, "crewboard.html is missing the generated-file banner — was it built by the script?");
});

test("crewboard-data.private.json (if present) is never tracked by git", () => {
  if (!existsSync(PRIVATE_DATA)) return; // fine — not everyone has built the private app locally
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "--error-unmatch", "crewboard-data.private.json"], { cwd: repo, stdio: "pipe" }).toString();
  } catch {
    tracked = "";
  }
  assert.equal(tracked.trim(), "", "crewboard-data.private.json is TRACKED BY GIT — it must stay git-ignored (real personal data)");
});

test("crewboard.html (if present) is git-ignored", () => {
  if (!existsSync(PRIVATE_OUT)) return;
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "--error-unmatch", "crewboard.html"], { cwd: repo, stdio: "pipe" }).toString();
  } catch {
    tracked = "";
  }
  assert.equal(tracked.trim(), "", "crewboard.html is TRACKED BY GIT — it must stay git-ignored (real personal data)");
});
