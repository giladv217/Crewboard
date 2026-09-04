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
//   * the public template ships an EMPTY DEFAULT_ROUTE_BLOCK_ESTIMATES ({}) —
//     the private route table lives only in crewboard.html
//
// Run:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const template = readFileSync(join(repo, "crewboard-template.html"), "utf8");
const privateFile = readFileSync(join(repo, "crewboard.html"), "utf8");

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

test("the private route table still exists in crewboard.html (const + Settings textarea)", () => {
  const m = privateFile.match(/const DEFAULT_ROUTE_BLOCK_ESTIMATES = \{([\s\S]*?)\};/);
  assert.ok(m, "DEFAULT_ROUTE_BLOCK_ESTIMATES const present");
  const entries = (m[1].match(/"[A-Z]{3}-[A-Z]{3}":\s*\d/g) || []).length;
  assert.ok(entries >= 40, `expected the full route table, found ${entries} entries`);
  assert.match(privateFile, /<textarea id="route-estimates"[^>]*>\s*[A-Z]{3}-[A-Z]{3}:/);
});

test("getForecastEstimates merges the textarea then the private DEFAULT table (roster/forecast view)", () => {
  const src = extractFn(template, "getForecastEstimates");
  assert.match(src, /getRouteEstimates\(\)/);
  assert.match(src, /DEFAULT_ROUTE_BLOCK_ESTIMATES\[k\] \/ 60/);
});
