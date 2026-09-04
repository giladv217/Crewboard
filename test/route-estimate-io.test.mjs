// Step 3E usability: local-only Route Block-Hour Estimates export / import.
//
// Extracts the REAL shipped pure functions from crewboard-template.html.
// No framework, no DOM, no network.
//
// Run:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const TEMPLATE = join(repo, "crewboard-template.html");
const INDEX = join(repo, "index.html");
const html = readFileSync(TEMPLATE, "utf8");

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
function extractConst(src, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*`).exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  return src.slice(m.index, src.indexOf(";", m.index) + 1).replace(/^const /, "var ");
}

const sandbox = { Number, Math, String, Object, JSON, isNaN, parseInt, parseFloat, RegExp, Array };
vm.createContext(sandbox);
vm.runInContext(
  [
    extractConst(html, "ROUTE_ESTIMATE_SCHEMA"),
    extractConst(html, "ROUTE_KEY_RE"),
    extractFn(html, "buildRouteEstimateExport"),
    extractFn(html, "parseRouteEstimateImport"),
    extractFn(html, "resolveLegBlock"),
  ].join("\n"),
  sandbox
);
const { buildRouteEstimateExport, parseRouteEstimateImport, resolveLegBlock } = sandbox;

const sameKeys = (obj, keys) => assert.deepEqual(Object.keys(obj).sort(), [...keys].sort());
// sandbox objects have a foreign prototype -> compare by field
function sameRoutes(a, b) {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), "route key sets differ");
  for (const k of Object.keys(b)) assert.equal(a[k], b[k], `route ${k}`);
}

// ---------------------------------------------------------------- export

test("export contains ONLY {schema, routes} — no other CrewBoard data can leak", () => {
  const doc = buildRouteEstimateExport({ "TLV-BUD": 3.5, "BUD-TLV": 3.25 });
  sameKeys(doc, ["schema", "routes"]);
  assert.equal(doc.schema, "crewboard.route-estimates/v1");
  sameKeys(doc.routes, ["TLV-BUD", "BUD-TLV"]);
  assert.equal(doc.routes["TLV-BUD"], 3.5);
});

test("export sorts keys, rounds to 2dp, and drops anything that isn't a clean route→hours pair", () => {
  const doc = buildRouteEstimateExport({
    "TLV-BUD": 3.512345,
    "ATH-TLV": 2,
    "tlvbud": 3, // bad key
    "TLV-TLV": 2, // same airport
    "JFK-TLV": 0, // non-positive
    "TLV-JFK": 40, // out of range
  });
  assert.deepEqual(Object.keys(doc.routes), ["ATH-TLV", "TLV-BUD"]);
  assert.equal(doc.routes["TLV-BUD"], 3.51);
});

// ---------------------------------------------------------------- import validation

test("round-trips: export -> JSON -> import gives back the same route data", () => {
  const src = { "TLV-BUD": 3.5, "BUD-TLV": 3.25, "TLV-VAR": 2.2 };
  const text = JSON.stringify(buildRouteEstimateExport(src));
  const r = parseRouteEstimateImport(text);
  assert.equal(r.ok, true);
  assert.equal(r.added, 3);
  assert.equal(r.skipped, 0);
  sameRoutes(r.routes, { "TLV-BUD": 3.5, "BUD-TLV": 3.25, "TLV-VAR": 2.2 });
});

test("invalid JSON is rejected safely", () => {
  const r = parseRouteEstimateImport("{ not json ");
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

test("wrong / missing schema is rejected", () => {
  assert.equal(parseRouteEstimateImport(JSON.stringify({ routes: { "TLV-BUD": 3 } })).ok, false);
  assert.equal(parseRouteEstimateImport(JSON.stringify({ schema: "other", routes: { "TLV-BUD": 3 } })).ok, false);
  assert.equal(parseRouteEstimateImport(JSON.stringify({ schema: "crewboard.route-estimates/v1" })).ok, false); // no routes
  assert.equal(parseRouteEstimateImport(JSON.stringify(["TLV-BUD", 3])).ok, false); // array
});

test("invalid route KEYS are skipped, not fatal", () => {
  const r = parseRouteEstimateImport(JSON.stringify({
    schema: "crewboard.route-estimates/v1",
    routes: { "TLV-BUD": 3.5, "TLVBUD": 3, "TL-BUD": 3, "TLV-BUD-X": 3, "TLV-TLV": 3, "TLV-123": 3 },
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.routes), ["TLV-BUD"]);
  assert.equal(r.skipped, 5);
});

test("lower-case route keys are accepted (normalised to upper-case)", () => {
  const r = parseRouteEstimateImport(JSON.stringify({ schema: "crewboard.route-estimates/v1", routes: { "tlv-bud": 3.5 } }));
  assert.equal(r.ok, true);
  sameRoutes(r.routes, { "TLV-BUD": 3.5 });
});

test("invalid block VALUES are skipped (0, negative, NaN, out-of-bounds)", () => {
  const r = parseRouteEstimateImport(JSON.stringify({
    schema: "crewboard.route-estimates/v1",
    routes: { "TLV-BUD": 3.5, "BUD-TLV": 0, "TLV-VAR": -1, "VAR-TLV": "abc", "TLV-JFK": 99, "JFK-TLV": 0.01, "TLV-ATH": null },
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.routes), ["TLV-BUD"]);
  assert.equal(r.skipped, 6);
});

test("a file with zero valid entries is rejected (not silently empty)", () => {
  const r = parseRouteEstimateImport(JSON.stringify({ schema: "crewboard.route-estimates/v1", routes: { "x": 1, "TLV-TLV": 2 } }));
  assert.equal(r.ok, false);
  assert.equal(r.skipped, 2);
});

// ---------------------------------------------------------------- data authority (item E)

test("an imported estimate is selected by resolveLegBlock as 'route_estimate'", () => {
  const imported = parseRouteEstimateImport(JSON.stringify({ schema: "crewboard.route-estimates/v1", routes: { "TLV-BUD": 3.5 } })).routes;
  const r = resolveLegBlock({ from: "TLV", to: "BUD", block: null }, imported, null);
  assert.equal(r.blockSource, "route_estimate");
  assert.equal(r.blockHours, 3.5);
});

test("real roster block still wins over an imported estimate; leg.block untouched", () => {
  const imported = { "TLV-BUD": 3.5 };
  const leg = { from: "TLV", to: "BUD", block: 3.2 };
  const r = resolveLegBlock(leg, imported, { flightStatus: { found: true, scheduledBlockMinutes: 200 } });
  assert.equal(r.blockSource, "roster");
  assert.equal(leg.block, 3.2);
});

test("AeroDataBox stays third: imported estimate wins over it; with no estimate it is used; none otherwise", () => {
  const fs = { flightStatus: { found: true, scheduledBlockMinutes: 205 } };
  assert.equal(resolveLegBlock({ from: "TLV", to: "BUD", block: null }, { "TLV-BUD": 3.5 }, fs).blockSource, "route_estimate");
  assert.equal(resolveLegBlock({ from: "TLV", to: "BUD", block: null }, {}, fs).blockSource, "aerodatabox_schedule");
  assert.equal(resolveLegBlock({ from: "TLV", to: "BUD", block: null }, {}, null).blockSource, "none");
});

// ---------------------------------------------------------------- privacy / build hygiene

test("public template/index still ship an EMPTY route table and no private route data", () => {
  const t = readFileSync(TEMPLATE, "utf8");
  assert.match(t, /const DEFAULT_ROUTE_BLOCK_ESTIMATES = \{\};/);
  assert.match(t, /<textarea id="route-estimates"[^>]*><\/textarea>/);
  assert.equal(/"[A-Z]{3}-[A-Z]{3}":\s*\d/.test(t.split("function getRouteEstimates")[0]), false);
  for (const secret of ["503.19", "58.41"]) assert.equal(t.includes(secret), false);
});

test("the export/import glue never touches non-route storage keys", () => {
  for (const fn of ["exportRouteEstimates", "handleRouteEstimateImport", "buildRouteEstimateExport", "parseRouteEstimateImport"]) {
    const src = extractFn(html, fn);
    for (const bad of ["pilot-role", "rate-hourly", "seniority-value", "rate-transport", "drive-time-minutes", "backend-url", "crewboard-roster", "ROSTER_STORE_KEY"]) {
      assert.equal(src.includes(bad), false, `${fn} must not reference ${bad}`);
    }
  }
  // it only reads getForecastEstimates / getRouteEstimates and writes the route-estimates textarea
  assert.match(extractFn(html, "handleRouteEstimateImport"), /getElementById\('route-estimates'\)/);
});

test("index.html is byte-identical to crewboard-template.html", () => {
  assert.ok(readFileSync(TEMPLATE).equals(readFileSync(INDEX)));
});

test("crewboard.html is git-ignored", () => {
  assert.equal(execSync("git check-ignore crewboard.html || true", { cwd: repo }).toString().trim(), "crewboard.html");
});
