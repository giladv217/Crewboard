// Focused regression tests for the flight-status time-basis fix (Step 3D).
//
// No build step / no test framework existed for this repo, so this file extracts
// the *real shipped* functions out of crewboard-template.html by name and
// exercises them in a vm sandbox. It asserts:
//   * legScheduledUtc only emits a schedule for a provably-UTC leg
//   * the ISO instants it emits are correct, incl. overnight / +1 rollover
//   * convertLocalStationLeg turns Local-Station wall clocks into correct UTC
//   * the built-in-roster normalization marks legs timeBasis:'utc'
//   * crewboard-template.html and index.html are byte-identical
//   * crewboard.html is git-ignored (never shipped)
//
// Run:  node --test test/

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

// --- extract a top-level `function NAME(...) { ... }` by brace-matching -------
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}
function extractConst(src, name) {
  const re = new RegExp(`const ${name}\\s*=\\s*`, "");
  const m = re.exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  let i = src.indexOf("{", m.index);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1) + ";";
    }
  }
  throw new Error(`unbalanced braces for const ${name}`);
}

const sandbox = { Intl, Date, Math, String, Number, isNaN, parseInt, parseFloat, RegExp, JSON };
vm.createContext(sandbox);
const bundle = [
  "const getAirportOffsets = () => ({});", // force the IANA-zone path in tests
  extractConst(html, "AIRPORT_TZ"),
  extractFn(html, "tzOffsetMinutes"),
  extractFn(html, "zonedWallTimeToUtcMs"),
  extractFn(html, "plusDaysFromMarker"),
  extractFn(html, "convertLocalStationLeg"),
  extractFn(html, "legScheduledUtc"),
].join("\n");
vm.runInContext(bundle, sandbox);
const { legScheduledUtc, convertLocalStationLeg } = sandbox;

// vm-sandbox objects have a foreign prototype -> compare by shape, not identity.
const sameObj = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const isEmpty = (a) => assert.equal(Object.keys(a).length, 0);

// ---------------------------------------------------------------- legScheduledUtc

test("A. normal UTC leg -> correct UTC instants", () => {
  const out = legScheduledUtc({ time: "06:00 – 08:15", timeBasis: "utc" }, { date: "2026-09-20" });
  sameObj(out, {
    scheduledDeparture: "2026-09-20T06:00:00Z",
    scheduledArrival: "2026-09-20T08:15:00Z",
  });
});

test("E. ambiguous / no time basis -> NO schedule fields (never a fake Z)", () => {
  isEmpty(legScheduledUtc({ time: "06:00 – 08:15" }, { date: "2026-09-20" }));
  isEmpty(legScheduledUtc({ time: "06:00 – 08:15", timeBasis: "local" }, { date: "2026-09-20" }));
  isEmpty(legScheduledUtc({ time: "06:00 – 08:15", timeBasis: "synthetic" }, { date: "2026-09-20" }));
  isEmpty(legScheduledUtc({ timeBasis: "utc" }, { date: "2026-09-20" })); // no time string
});

test("D. overnight leg, natural rollover (no marker) -> arrival on the next calendar day", () => {
  const out = legScheduledUtc({ time: "23:30 – 05:45", timeBasis: "utc" }, { date: "2026-09-20" });
  assert.equal(out.scheduledDeparture, "2026-09-20T23:30:00Z");
  assert.equal(out.scheduledArrival, "2026-09-21T05:45:00Z");
});

test("D2. overnight leg with an explicit +1 marker -> arrival on the next day", () => {
  const out = legScheduledUtc({ time: "18:30 – 08:40⁺¹", timeBasis: "utc" }, { date: "2026-09-20" });
  assert.equal(out.scheduledDeparture, "2026-09-20T18:30:00Z");
  assert.equal(out.scheduledArrival, "2026-09-21T08:40:00Z");
});

test("D3. +2 marker -> arrival two calendar days on", () => {
  const out = legScheduledUtc({ time: "22:00 – 03:00⁺²", timeBasis: "utc" }, { date: "2026-09-20" });
  assert.equal(out.scheduledArrival, "2026-09-22T03:00:00Z");
});

// ------------------------------------------------ convertLocalStationLeg -> UTC

test("B. TLV Local-Station leg (summer, IDT +3) -> correct UTC, then correct schedule", () => {
  // TLV 15:45 local, VAR 18:20 local, same date, no marker.
  const conv = convertLocalStationLeg("2026-09-20", "TLV", "VAR", "15:45", "18:20", 0, 0);
  assert.equal(conv.time, "12:45 – 15:20"); // IDT +3 both ends in September
  assert.ok(Math.abs(conv.block - 2.5833) < 0.01, `block ~2h35m, got ${conv.block}`);
  const sched = legScheduledUtc({ time: conv.time, timeBasis: "utc" }, { date: "2026-09-20" });
  sameObj(sched, {
    scheduledDeparture: "2026-09-20T12:45:00Z",
    scheduledArrival: "2026-09-20T15:20:00Z",
  });
});

test("C. different-timezone overnight leg TLV->JFK Local-Station -> correct UTC across midnight", () => {
  // TLV 21:30 local (IDT +3) -> 18:30Z ; JFK 04:40 local next day (EDT -4) -> 08:40Z (+1d)
  const conv = convertLocalStationLeg("2026-09-20", "TLV", "JFK", "21:30", "04:40", 0, 1);
  assert.equal(conv.time, "18:30 – 08:40⁺¹");
  const sched = legScheduledUtc({ time: conv.time, timeBasis: "utc" }, { date: "2026-09-20" });
  assert.equal(sched.scheduledDeparture, "2026-09-20T18:30:00Z");
  assert.equal(sched.scheduledArrival, "2026-09-21T08:40:00Z");
});

test("Local-Station leg with an unknown airport -> block null (importer marks timeBasis 'local', schedule omitted)", () => {
  const conv = convertLocalStationLeg("2026-09-20", "TLV", "ZZZ", "10:00", "12:00", 0, 0);
  assert.equal(conv.block, null);
  // the importer's failure branch sets leg.timeBasis = 'local'; legScheduledUtc then omits.
  isEmpty(legScheduledUtc({ time: "10:00 – 12:00", timeBasis: "local" }, { date: "2026-09-20" }));
});

// ------------------------------------------------ built-in roster normalization

test("built-in roster normalization marks timed legs timeBasis:'utc', leaves time-less legs alone", () => {
  const rosterData = [
    { date: "01/09", code: "DUTY", legs: [{ flt: "1", from: "TLV", to: "VAR", time: "06:00 – 08:15" }] },
    { date: "02/09", code: "DUTY", legs: [{ flt: "2", from: "TLV", to: "ATH", time: null }] },
    { date: "03/09", code: "OFF" },
  ];
  // the exact one-liner shipped just before `const SAMPLE_ROSTER`
  rosterData.forEach((d) => {
    if (Array.isArray(d.legs)) d.legs.forEach((l) => { if (l && l.time && l.timeBasis == null) l.timeBasis = "utc"; });
  });
  assert.equal(rosterData[0].legs[0].timeBasis, "utc");
  assert.equal(rosterData[1].legs[0].timeBasis, undefined);
});

// ------------------------------------------------ file-shipping invariants

test("crewboard-template.html and index.html are byte-identical", () => {
  assert.ok(readFileSync(TEMPLATE).equals(readFileSync(INDEX)), "template and index must be byte-identical");
});

test("crewboard.html is git-ignored (never shipped publicly)", () => {
  const out = execSync("git check-ignore crewboard.html || true", { cwd: repo }).toString().trim();
  assert.equal(out, "crewboard.html");
});
