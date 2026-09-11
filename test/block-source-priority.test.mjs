// Regression guard for the block-source priority in CrewBoard.
//
// Added after a "flights show no block times" report — investigation found NO
// code regression (the shipped resolveLegBlock is correct), so this file locks
// the contract down:
//
//   1. real roster block (leg.block)      -> "roster"              wins over everything
//   2. manual route estimate table         -> "route_estimate"      2nd
//   3. AeroDataBox scheduled block (ctx)   -> "aerodatabox_schedule" 3rd, forecast-only
//   4. nothing                             -> "none"
//
//   * resolveLegBlock NEVER writes leg.block
//   * route keys are directional ("TLV-BUD" != "BUD-TLV")
//   * DEFAULT_ROUTE_BLOCK_ESTIMATES ships EMPTY everywhere (template, index,
//     and the private crewboard.html) — per-pilot route estimates are entered
//     at runtime via the Settings "Route Block-Hour Estimates" textarea and
//     kept only in localStorage, never baked into any HTML source
//
// Run:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const template = readFileSync(join(repo, "crewboard-template.html"), "utf8");
// crewboard.html is git-ignored and only exists once the private build has
// been run locally — legitimately absent on a fresh clone / CI.
const PRIVATE_PATH = join(repo, "crewboard.html");
const privateFile = existsSync(PRIVATE_PATH) ? readFileSync(PRIVATE_PATH, "utf8") : null;

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces for ${name}`);
}

const sandbox = { Math, Number, String, Object, isNaN, parseFloat };
vm.createContext(sandbox);
vm.runInContext(extractFn(template, "resolveLegBlock"), sandbox);
const { resolveLegBlock } = sandbox;

const TABLE = { "TLV-BUD": 3.5, "BUD-TLV": 3.2 }; // decimal hours, as getForecastEstimates returns
const FS_OK = { found: true, scheduledBlockMinutes: 205, checkedAt: "2026-09-19T00:00:00Z" };

// ---------------------------------------------------------------- priority

test("1. real roster block wins over the route table AND AeroDataBox", () => {
  const leg = { from: "TLV", to: "BUD", block: 3.4 };
  const r = resolveLegBlock(leg, TABLE, { flightStatus: FS_OK });
  assert.equal(r.blockSource, "roster");
  assert.equal(r.blockHours, 3.4);
  assert.equal(r.estimated, false);
  assert.equal(leg.block, 3.4, "leg.block must be untouched");
});

test("2. no real block -> manual route estimate wins over AeroDataBox", () => {
  const leg = { from: "TLV", to: "BUD", block: null };
  const r = resolveLegBlock(leg, TABLE, { flightStatus: FS_OK });
  assert.equal(r.blockSource, "route_estimate");
  assert.equal(r.blockHours, 3.5);
  assert.equal(r.estimated, true);
  assert.equal(leg.block, null, "resolveLegBlock must never write leg.block");
});

test("3. no real block, no route estimate -> AeroDataBox scheduled block (forecast only)", () => {
  const leg = { from: "TLV", to: "BUD", block: null };
  const r = resolveLegBlock(leg, {}, { flightStatus: FS_OK });
  assert.equal(r.blockSource, "aerodatabox_schedule");
  assert.equal(Math.round(r.blockMinutes), 205);
  assert.equal(r.estimated, true);
  assert.equal(leg.block, null);
});

test("3b. AeroDataBox is opt-in: no ctx -> it is never consulted", () => {
  const r = resolveLegBlock({ from: "TLV", to: "BUD", block: null }, {}, null);
  assert.equal(r.blockSource, "none");
});

test("3c. implausible AeroDataBox span (<20m or >1200m) is rejected", () => {
  assert.equal(resolveLegBlock({ from: "A", to: "B", block: null }, {}, { flightStatus: { found: true, scheduledBlockMinutes: 5 } }).blockSource, "none");
  assert.equal(resolveLegBlock({ from: "A", to: "B", block: null }, {}, { flightStatus: { found: true, scheduledBlockMinutes: 5000 } }).blockSource, "none");
});

test("4. nothing available -> 'none', null block, no estimate shown", () => {
  const r = resolveLegBlock({ from: "TLV", to: "ZZZ", block: null }, TABLE, null);
  assert.equal(r.blockSource, "none");
  assert.equal(r.blockMinutes, null);
  assert.equal(r.blockHours, null);
});

// ---------------------------------------------------------------- key format

test("route table keys are directional — the return leg needs its own entry", () => {
  assert.equal(resolveLegBlock({ from: "TLV", to: "BUD", block: null }, TABLE, null).blockHours, 3.5);
  assert.equal(resolveLegBlock({ from: "BUD", to: "TLV", block: null }, TABLE, null).blockHours, 3.2);
  // a route present in only one direction -> the other direction gets no estimate
  assert.equal(resolveLegBlock({ from: "TLV", to: "VAR", block: null }, { "TLV-VAR": 2.2 }, null).blockSource, "route_estimate");
  assert.equal(resolveLegBlock({ from: "VAR", to: "TLV", block: null }, { "TLV-VAR": 2.2 }, null).blockSource, "none");
});

test("lookup key is exactly `${from}-${to}` (upper-case 3-letter codes)", () => {
  assert.match(extractFn(template, "resolveLegBlock"), /\(\(l && l\.from\) \|\| ''\) \+ '-' \+ \(\(l && l\.to\) \|\| ''\)/);
});

// ---------------------------------------------------------------- privacy

test("PUBLIC template ships an EMPTY route table (private data stays in crewboard.html)", () => {
  assert.match(template, /const DEFAULT_ROUTE_BLOCK_ESTIMATES = \{\};/);
  // no baked route entries, no textarea default content
  assert.equal(/"[A-Z]{3}-[A-Z]{3}":\s*\d/.test(template.split("function getRouteEstimates")[0]), false);
  assert.match(template, /<textarea id="route-estimates"[^>]*><\/textarea>/);
});

test("crewboard.html (if built locally) also ships an EMPTY DEFAULT_ROUTE_BLOCK_ESTIMATES — route estimates are runtime-only, never baked in", (t) => {
  if (!privateFile) { t.skip("crewboard.html not built locally — nothing to check"); return; }
  assert.match(privateFile, /const DEFAULT_ROUTE_BLOCK_ESTIMATES = \{\};/);
  assert.match(privateFile, /<textarea id="route-estimates"[^>]*><\/textarea>/);
});

test("getForecastEstimates merges the textarea then the private DEFAULT table (roster/forecast view)", () => {
  const src = extractFn(template, "getForecastEstimates");
  assert.match(src, /getRouteEstimates\(\)/);
  assert.match(src, /DEFAULT_ROUTE_BLOCK_ESTIMATES\[k\] \/ 60/);
});
