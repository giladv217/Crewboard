// Production bug fix — AIMS calendar-sync (and screenshot-import) legs were
// displaying a UTC-converted departure/arrival pair in the Roster tab instead
// of the true AIMS "All times in Local Station" wall-clock times the Review
// screen correctly showed before Confirm (e.g. review: "06:01–09:09" TLV-BUS;
// roster after apply: "03:01–05:09" — the same value converted through each
// airport's own UTC offset).
//
// Root cause: normalizedActivityToRosterDay() already computes and stores the
// correct raw local pair on leg.localTime (for a lossless round-trip), but
// every user-facing renderer read leg.time directly, which stays UTC-
// converted on purpose — block hours, Shabbat detection, and flight-status
// registration all depend on leg.time staying UTC and must NOT change.
//
// Fix: a single DISPLAY-ONLY helper, legDisplayTime(l), used by every
// renderer that prints a leg's time to the pilot. leg.time / leg.timeBasis /
// leg.block / the AIMS fact hash / Shabbat logic / flight-status logic are
// completely untouched — this file locks that down explicitly.
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
const html = readFileSync(join(repo, "crewboard-template.html"), "utf8");

function extractFn(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`function ${name} not found`);
  const asyncPrefix = /async\s+$/.test(src.slice(Math.max(0, start - 10), start)) ? "async " : "";
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return asyncPrefix + src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces for ${name}`);
}
function extractConst(src, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*`).exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  const semi = src.indexOf(";", m.index);
  // AIRPORT_TZ / DUTY_CODE_MAP / AIRPORT_UTC_OFFSET are object literals that
  // may contain a `;` only at their true end (no strings with semicolons in
  // these tables), so a plain indexOf(";", ...) is safe here.
  return src.slice(m.index, semi + 1).replace(/^const /, "var ");
}

const sandbox = {
  console, JSON, Math, String, Number, Object, Array, isNaN, Date, Intl, RegExp,
  document: { getElementById: () => null },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
vm.createContext(sandbox);
vm.runInContext(
  [
    extractConst(html, "WEEK"),
    extractConst(html, "AIRPORT_TZ"),
    extractConst(html, "AIRPORT_UTC_OFFSET"),
    extractConst(html, "DUTY_CODE_MAP"),
    extractConst(html, "LEGACY_ROSTER_YEAR"),
    extractFn(html, "getAirportOffsets"),
    extractFn(html, "tzOffsetMinutes"),
    extractFn(html, "zonedWallTimeToUtcMs"),
    extractFn(html, "convertLocalStationLeg"),
    extractFn(html, "computeUtcBlock"),
    extractFn(html, "_isoToDDMM"),
    extractFn(html, "_normTypeToCode"),
    extractConst(html, "_TIME_RE") + ";", // already `const NAME = /regex/;` shape
    extractFn(html, "normalizedActivityToRosterDay"),
    extractFn(html, "legDisplayTime"),
    // legOverlapsShabbatWindow now resolves times via the SAME authoritative UTC-conversion
    // chain (legDepUtcMs/legArrUtcMs -> _parseLegClock -> leg.time) every other timezone-
    // sensitive feature uses, DST-aware via zonedWallTimeToUtcMs -- replaces the old hardcoded
    // +3h toIsraelLocal()/dayOffset() (removed, no other callers).
    extractFn(html, "isValidYear"),
    extractFn(html, "dayYear"),
    extractFn(html, "_dayDateParts"),
    extractFn(html, "plusDaysFromMarker"),
    extractFn(html, "_parseLegClock"),
    extractFn(html, "legDepUtcMs"),
    extractFn(html, "legArrUtcMs"),
    extractFn(html, "legOverlapsShabbatWindow"),
    extractFn(html, "isShabbatDay"),
  ].join("\n"),
  sandbox
);
const { normalizedActivityToRosterDay, legDisplayTime, isShabbatDay } = sandbox;

// ---------------------------------------------------------------- fixtures (synthetic, no real personal data)

// Mirrors what aimsExtractionToNormalized() produces for an AIMS-calendar-sync
// (or screenshot-import) flight leg: timesAreUtc:false, raw local departure/
// arrival station times, per the "* All times in Local Station" AIMS note.
function aimsLeg(overrides) {
  return Object.assign(
    {
      date: "2026-09-14",
      activityType: "FLIGHT",
      timesAreUtc: false,
      flightNumber: "883",
      origin: "TLV",
      destination: "BUS",
      reportTime: "04:25",
      departureTime: "06:01",
      arrivalTime: "09:09",
      validationStatus: "VALID",
    },
    overrides || {}
  );
}

// ---------------------------------------------------------------- the core regression

test("cross-timezone leg (TLV->BUS, actual A-prefixed AIMS times): displayed time matches the source exactly, leg.time stays UTC-converted", () => {
  const { day } = normalizedActivityToRosterDay(aimsLeg());
  const leg = day.legs[0];
  assert.equal(leg.localTime, "06:01 – 09:09", "leg.localTime must be the untouched AIMS source pair");
  assert.equal(legDisplayTime(leg), "06:01 – 09:09", "the display helper must show the source pair, matching what Review showed");
  // leg.time is UNCHANGED by this fix — still UTC, still what block/Shabbat/flight-status read.
  assert.equal(leg.time, "03:01 – 05:09", "leg.time must remain the UTC-converted value (internal use only)");
  assert.equal(leg.timeBasis, "utc");
});

test("leg.block is unaffected by the display fix — still the real cross-timezone elapsed duration", () => {
  const { day } = normalizedActivityToRosterDay(aimsLeg());
  // 09:09 BUS (UTC+4) - 06:01 TLV (UTC+3, September DST) = 05:09 - 03:01 UTC = 2h08m.
  // NOT the naive local-clock difference (09:09 - 06:01 = 3h08m), which would
  // silently overstate pay-relevant block hours by exactly the 1h zone gap.
  assert.equal(day.legs[0].block, Math.round((2 + 8 / 60) * 60) / 60);
});

test("two-leg rotation (883 TLV->BUS outbound, 884 BUS->TLV return): both legs display their own source local times", () => {
  const outbound = normalizedActivityToRosterDay(aimsLeg()).day.legs[0];
  const ret = normalizedActivityToRosterDay(
    aimsLeg({ date: "2026-09-15", flightNumber: "884", origin: "BUS", destination: "TLV", departureTime: "10:05", arrivalTime: "11:10", reportTime: "09:35" })
  ).day.legs[0];
  assert.equal(legDisplayTime(outbound), "06:01 – 09:09");
  assert.equal(legDisplayTime(ret), "10:05 – 11:10");
  // Return leg block: 11:10 TLV (UTC 08:10) - 10:05 BUS (UTC 06:05) = 2h05m.
  assert.equal(ret.block, Math.round((2 + 5 / 60) * 60) / 60);
});

test("same-timezone pair (TLV->ETM, both Asia/Jerusalem): local display equals source; UTC leg.time is a uniform -3h shift", () => {
  const { day } = normalizedActivityToRosterDay(aimsLeg({ origin: "TLV", destination: "ETM", departureTime: "07:00", arrivalTime: "08:00" }));
  const leg = day.legs[0];
  assert.equal(legDisplayTime(leg), "07:00 – 08:00");
  assert.equal(leg.time, "04:00 – 05:00");
  assert.equal(leg.block, 1); // same-zone pair: elapsed time is identical in either frame
});

test("fallback: a leg with no localTime (XLSX / manual / already-UTC import) displays leg.time unchanged", () => {
  assert.equal(legDisplayTime({ time: "10:00 – 12:00", timeBasis: "utc" }), "10:00 – 12:00");
  assert.equal(legDisplayTime({ time: null }), null);
  assert.equal(legDisplayTime({}), null);
  // A leg whose times were already UTC on import (Google Location Zulu window,
  // or a genuine UTC-basis source) never gets a localTime — confirm the real
  // conversion function agrees.
  const { day } = normalizedActivityToRosterDay(aimsLeg({ timesAreUtc: true, utcDepartureTime: undefined }));
  assert.equal(day.legs[0].localTime, undefined, "a UTC-basis leg must not get a spurious localTime");
  assert.equal(legDisplayTime(day.legs[0]), day.legs[0].time);
});

test("Shabbat detection is untouched: it reads leg.time (still UTC), never leg.localTime", () => {
  // legOverlapsShabbatWindow() itself no longer references `l.time` directly — it now resolves
  // dep/arr through legDepUtcMs()/legArrUtcMs() (DST-aware, via zonedWallTimeToUtcMs), which in
  // turn parse the leg's clock through _parseLegClock(). Check the WHOLE chain, not just the
  // outer function, for the same invariant this test has always protected: Shabbat detection
  // must read the canonical UTC-basis leg.time, never the display-only leg.localTime override.
  const chain = [
    extractFn(html, "legOverlapsShabbatWindow"),
    extractFn(html, "legDepUtcMs"),
    extractFn(html, "legArrUtcMs"),
    extractFn(html, "_parseLegClock"),
  ].join("\n");
  assert.match(chain, /leg\.time/);
  assert.equal(chain.includes("localTime"), false, "Shabbat detection must not be changed to read localTime");

  // A leg whose (unchanged, UTC) leg.time crosses Fri 19:00 - Sat 21:00 Israel
  // local — regardless of what leg.localTime says — must still register as Shabbat.
  const fridayLeg = normalizedActivityToRosterDay(
    aimsLeg({ date: "2026-09-18", origin: "TLV", destination: "BUS", departureTime: "22:30", arrivalTime: "23:40" }) // Friday, well into Shabbat in Israel local
  ).day;
  fridayLeg.day = "FRI";
  assert.equal(isShabbatDay(fridayLeg), true);
});

test("screenshot-import path shares the same fix (same function, same source-of-truth AIMS data)", () => {
  // aimsExtractionToNormalized(ex, 'SCREENSHOT') feeds the identical
  // normalizedActivityToRosterDay() — no separate code path to fix or forget.
  const { day } = normalizedActivityToRosterDay(aimsLeg({}));
  assert.equal(legDisplayTime(day.legs[0]), "06:01 – 09:09");
});

// ---------------------------------------------------------------- render-site audit (static)

test("renderRoster and showReview call the shared display helper, not leg.time directly", () => {
  const rosterSlice = html.slice(html.indexOf("function renderRoster("), html.indexOf("function renderRoster(") + 6000);
  assert.match(rosterSlice, /legDisplayTime\(l\)/, "renderRoster must use legDisplayTime for its leg time cell");

  const reviewSlice = html.slice(html.indexOf("document.getElementById('review-panel').innerHTML = html;") - 2000, html.indexOf("document.getElementById('review-panel').innerHTML = html;"));
  assert.match(reviewSlice, /legDisplayTime\(l\)/, "showReview's leg-row must use legDisplayTime");
});

test("the Calendar tab and family-image export never render a leg's departure/arrival time (nothing to fix there)", () => {
  const calSrc = extractFn(html, "buildCalendarDays");
  assert.equal(/\bl\.time\b/.test(calSrc), false);
  const famSrc = extractFn(html, "generateFamilyImage");
  assert.equal(/\bl\.time\b/.test(famSrc), false);
  // Confirms the audit in the investigation report: only report/debrief
  // (already always local, unaffected) and destination codes are shown there.
});
