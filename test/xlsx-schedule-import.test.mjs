// Regression coverage for the "Schedule"/"Flights" multi-sheet crew workbook importer
// (added to read a real-world eCrew export shape distinct from the existing single-sheet
// "Personal Crew Schedule Report" format parseSpreadsheetRoster already handles).
//
// All fixture data below is entirely synthetic (fake pilot name, fake flight numbers, fake
// dates/routes) reproducing the real workbook's structure — no personal roster data is used
// or committed here. The real file (never copied into this repo) was only used, in a separate
// throwaway scratch environment, to confirm the exact cell shapes asserted in these fixtures.
//
// Extracts the REAL shipped pure functions from crewboard-template.html, same style as the
// other test files in this directory. XLSX.utils.sheet_to_json is stubbed to the identity
// function so a "sheet" here is simply the rows array a real sheet_to_json({header:1}) call
// would already have produced — the functions under test never touch the XLSX library itself
// beyond that one call, so this is a faithful test of the shipped code, not a reimplementation.
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

const sandbox = {
  Math, Number, String, Object, Array, JSON, Map, isNaN, parseInt, parseFloat, RegExp, Date,
  XLSX: { utils: { sheet_to_json: (sheet) => sheet } }, // rows-array in, rows-array out (see header note)
};
vm.createContext(sandbox);
vm.runInContext(
  [
    extractConst(html, "WEEK"),
    extractConst(html, "DUTY_CODE_MAP"),
    extractFn(html, "isValidYear"),
    extractFn(html, "computeUtcBlock"),
    extractFn(html, "plusDaysFromMarker"),
    extractFn(html, "parseCrewCell"),
    extractFn(html, "parseSpreadsheetRoster"),
    extractFn(html, "parseDisplayHM"),
    extractFn(html, "parseDDMMYYYY"),
    extractFn(html, "parseExcelSerialFallback"),
    extractFn(html, "parseSheetDate"),
    extractFn(html, "findHeaderRow"),
    extractConst(html, "SCHEDULE_HEADER_MATCHERS"),
    extractConst(html, "FLIGHTS_HEADER_MATCHERS"),
    extractFn(html, "parseScheduleSheetRows"),
    extractFn(html, "parseFlightsSheetRows"),
    extractFn(html, "mergeScheduleAndFlights"),
    extractFn(html, "tryParseScheduleWorkbook"),
    extractFn(html, "resolveLegBlock"),
  ].join("\n"),
  sandbox
);
const {
  parseSpreadsheetRoster, tryParseScheduleWorkbook, findHeaderRow,
  SCHEDULE_HEADER_MATCHERS, resolveLegBlock, WEEK,
} = sandbox;

// ------------------------------------------------------------------ fixtures (all synthetic)

// Header at array index 6 ("row 7") — metadata/title/name/id rows above it, exactly like the
// real export's shape, but with fake data throughout.
function scheduleRows() {
  return [
    ["Fake Personal Crew Schedule Report", "", "", "", "", "", "", ""],
    ["Period: 01/03/2027 to 10/03/2027 · All times in UTC · Actual", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["NAME", "TESTPILOT, FAKE", "", "", "", "", "", ""],
    ["ID / QUALIFICATION", "9999 (TLV FO-320)", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["Date", "Day", "Type", "Flight / Code", "From", "To", "Departure UTC", "Arrival UTC"],
    ["01/03/2027", "Mon", "", "", "", "", "", ""],                              // blank day — not imported
    ["02/03/2027", "Tue", "Flight", "101", "TLV", "LHR", "08:00", "11:30"],     // same-day flight
    ["03/03/2027", "Wed", "Status", "OFF", "", "", "", ""],
    ["04/03/2027", "Thu", "Status", ">OFF", "", "", "", ""],
    ["05/03/2027", "Fri", "Status", "OFFP", "", "", "", ""],
    ["06/03/2027", "Sat", "Flight", "202", "LHR", "JFK", "19:00", "02:15 (+1)"], // overnight via (+1) marker
    ["", "", "", "", "", "", "", ""],                                           // wholly blank row
    ["07/03/2027", "Sun", "", "", "", "", "", ""],                              // blank day
  ];
}

function flightsRows() {
  return [
    ["Date", "Flight", "From", "To", "Departure UTC", "Arrival Date", "Arrival UTC", "Aircraft"],
    ["02/03/2027", "101", "TLV", "LHR", "08:00", "02/03/2027", "11:30", "A320 (320)"], // matches Schedule -> must not duplicate
    ["06/03/2027", "202", "LHR", "JFK", "19:00", "07/03/2027", "02:15", "A330 (332)"], // overnight via explicit Arrival Date
    ["08/03/2027", "303", "JFK", "TLV", "", "08/03/2027", "", "A330 (332)"],           // blank times — not in Schedule at all
  ];
}

function wbWith(sheets) {
  return { SheetNames: Object.keys(sheets), Sheets: sheets };
}

// ------------------------------------------------------------------ header row detection

test("header row is found dynamically (row 7, not assumed to be row 1)", () => {
  const header = findHeaderRow(scheduleRows(), SCHEDULE_HEADER_MATCHERS, ["date", "day", "code", "from", "to"]);
  assert.ok(header);
  assert.equal(header.rowIdx, 6);
});

test("a workbook with no Schedule sheet is not recognized as this format", () => {
  const wb = wbWith({ Flights: flightsRows() });
  assert.equal(tryParseScheduleWorkbook(wb), null);
});

test("a Schedule sheet whose header is missing required columns is not recognized", () => {
  const brokenRows = scheduleRows();
  brokenRows[6] = ["Date", "Day", "Type", "Flight / Code", "", "", "Departure UTC", "Arrival UTC"]; // no From/To
  const wb = wbWith({ Schedule: brokenRows });
  assert.equal(tryParseScheduleWorkbook(wb), null);
});

// ------------------------------------------------------------------ Schedule-only (no Flights sheet)

test("Schedule sheet alone: statuses OFF / >OFF / OFFP preserved verbatim", () => {
  const wb = wbWith({ Schedule: scheduleRows() });
  const result = tryParseScheduleWorkbook(wb);
  assert.ok(result);
  const byCode = Object.fromEntries(result.days.filter(d => d.code !== "DUTY").map(d => [d.date, d]));
  assert.equal(byCode["03/03"].code, "OFF");
  assert.equal(byCode["03/03"].label, "Day off"); // from DUTY_CODE_MAP
  assert.equal(byCode["04/03"].code, ">OFF");     // never remapped onto OFF
  assert.equal(byCode["04/03"].label, ">OFF");    // no map entry -> literal fallback label
  assert.equal(byCode["05/03"].code, "OFFP");
  assert.equal(byCode["05/03"].label, "Paid day off");
});

test("blank-Type days and wholly blank rows are skipped, not fabricated", () => {
  const wb = wbWith({ Schedule: scheduleRows() });
  const result = tryParseScheduleWorkbook(wb);
  const dates = result.days.map(d => d.date);
  assert.equal(dates.includes("01/03"), false);
  assert.equal(dates.includes("07/03"), false);
});

test("Schedule-derived overnight flight: '(+1)' display marker -> next-day block + timeBasis 'utc'", () => {
  const wb = wbWith({ Schedule: scheduleRows() });
  const result = tryParseScheduleWorkbook(wb);
  const day = result.days.find(d => d.date === "06/03");
  assert.equal(day.code, "DUTY");
  const leg = day.legs[0];
  assert.equal(leg.timeBasis, "utc");
  assert.equal(leg.time, "19:00 – 02:15⁺¹");
  assert.equal(leg.block, 7.25); // 19:00 -> 02:15 next day
});

test("Schedule-derived same-day flight: correct block, directional route identity preserved", () => {
  const wb = wbWith({ Schedule: scheduleRows() });
  const result = tryParseScheduleWorkbook(wb);
  const day = result.days.find(d => d.date === "02/03");
  const leg = day.legs[0];
  assert.equal(leg.from, "TLV");
  assert.equal(leg.to, "LHR");
  assert.equal(leg.block, 3.5);
  assert.equal(leg.timeBasis, "utc");
});

// ------------------------------------------------------------------ Schedule + Flights together

test("Flights sheet present: flight rows are not duplicated (Flights replaces Schedule's leg for that date)", () => {
  const wb = wbWith({ Schedule: scheduleRows(), Flights: flightsRows() });
  const result = tryParseScheduleWorkbook(wb);
  const day0203 = result.days.find(d => d.date === "02/03");
  const day0603 = result.days.find(d => d.date === "06/03");
  assert.equal(day0203.legs.length, 1);
  assert.equal(day0603.legs.length, 1);
});

test("Flights sheet: overnight arrival via explicit next-day Arrival Date computed correctly", () => {
  const wb = wbWith({ Schedule: scheduleRows(), Flights: flightsRows() });
  const result = tryParseScheduleWorkbook(wb);
  const leg = result.days.find(d => d.date === "06/03").legs[0];
  assert.equal(leg.timeBasis, "utc");
  assert.equal(leg.block, 7.25);
  assert.equal(leg.time, "19:00 – 02:15⁺¹");
});

test("Flights sheet: a flight not present in Schedule at all still creates a day (merge, not overwrite-only)", () => {
  const wb = wbWith({ Schedule: scheduleRows(), Flights: flightsRows() });
  const result = tryParseScheduleWorkbook(wb);
  const day = result.days.find(d => d.date === "08/03");
  assert.ok(day, "expected a day entry created purely from the Flights sheet");
  assert.equal(day.code, "DUTY");
  assert.ok(WEEK.includes(day.day));
  assert.equal(day.legs[0].flt, "303");
});

test("Flights sheet: blank/unreadable times do not get a fabricated UTC block or timeBasis", () => {
  const wb = wbWith({ Schedule: scheduleRows(), Flights: flightsRows() });
  const result = tryParseScheduleWorkbook(wb);
  const leg = result.days.find(d => d.date === "08/03").legs[0];
  assert.equal(leg.block, null);
  assert.equal(leg.time, null);
  assert.equal(Object.prototype.hasOwnProperty.call(leg, "timeBasis"), false);
});

test("Flights sheet with unrecognized columns: falls back to Schedule data with a non-technical warning, not a hard failure", () => {
  const badFlights = flightsRows();
  badFlights[0] = ["Date", "Flight", "Origin", "Destination", "Departure UTC", "Arrival Date", "Arrival UTC", "Aircraft"]; // From/To renamed
  const wb = wbWith({ Schedule: scheduleRows(), Flights: badFlights });
  const result = tryParseScheduleWorkbook(wb);
  assert.ok(result.warnings.length > 0);
  assert.match(result.warnings[0], /Flights/);
  // still usable — Schedule-derived leg is there, not an empty/failed import
  assert.equal(result.days.find(d => d.date === "02/03").legs[0].block, 3.5);
});

test("days come out chronologically sorted (by real date, not just source row order)", () => {
  const wb = wbWith({ Schedule: scheduleRows(), Flights: flightsRows() });
  const result = tryParseScheduleWorkbook(wb);
  // spread first (in this realm) — result.days is a vm-sandbox array, and deepStrictEqual
  // rejects an otherwise-identical array from a different realm as "not reference-equal".
  const dutyDates = [...result.days].map(d => String(d.date));
  const sorted = [...dutyDates].sort((a, b) => {
    const [da, ma] = a.split("/").map(Number), [db, mb] = b.split("/").map(Number);
    return ma - mb || da - db;
  });
  assert.deepEqual(dutyDates, sorted);
});

test("imported leg integrates correctly with the existing block-source-priority contract (leg.block wins as 'roster')", () => {
  const wb = wbWith({ Schedule: scheduleRows() });
  const result = tryParseScheduleWorkbook(wb);
  const leg = result.days.find(d => d.date === "02/03").legs[0];
  const r = resolveLegBlock(leg, { "TLV-LHR": 9.99 }, { flightStatus: { found: true, scheduledBlockMinutes: 999 } });
  assert.equal(r.blockSource, "roster");
  assert.equal(r.blockHours, 3.5);
});

// ------------------------------------------------------------------ old single-sheet format unaffected

test("existing single-sheet 'Personal Schedule Report' format still imports unchanged (UTC path)", () => {
  const rows = [
    ["Fake Personal Schedule Report"],
    ["All times in UTC"],
    ["Date", "Duties", "Details", "Report times", "Actual times/Delays", "Debrief times", "Indicators", "Crew"],
    ["01/04/2027 Thu", "101", "TLV-LHR", "08:00", "08:05-11:35", "11:40", "", ""],
    ["02/04/2027 Fri", "OFF", "Day off", "", "", "", "", ""],
  ];
  const isUTC = rows.some(r => r.some(c => /All times in UTC/i.test(String(c || ""))));
  const parsed = parseSpreadsheetRoster(rows, isUTC);
  assert.equal(parsed.days.length, 2);
  const duty = parsed.days.find(d => d.code === "DUTY");
  assert.equal(duty.legs[0].from, "TLV");
  assert.equal(duty.legs[0].to, "LHR");
  assert.equal(duty.legs[0].block, 3.5);
  const off = parsed.days.find(d => d.code === "OFF");
  assert.equal(off.label, "Day off");
});
