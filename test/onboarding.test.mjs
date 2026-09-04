// Step 3E — first-run onboarding / personal profile.
//
// Extracts the REAL shipped pure functions from crewboard-template.html and
// exercises them, plus static checks on the shipped files. No framework, no DOM.
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
  const semi = src.indexOf(";", m.index);
  return src.slice(m.index, semi + 1);
}

const sandbox = { Number, Math, String, Object, JSON, isNaN, parseInt, parseFloat };
vm.createContext(sandbox);
vm.runInContext(
  [
    // top-level const/let don't attach to the vm context object -> use var
    extractConst(html, "PROFILE_FIELD").replace(/^const /, "var "),
    extractConst(html, "PROFILE_VERSION").replace(/^const /, "var "),
    extractFn(html, "profileFromStore"),
    extractFn(html, "isProfileComplete"),
    extractFn(html, "validateOnboarding"),
    extractFn(html, "applyProfileToStore"),
    extractFn(html, "stripProfileKeys"),
  ].join("\n"),
  sandbox
);
const { profileFromStore, isProfileComplete, validateOnboarding, applyProfileToStore, stripProfileKeys, PROFILE_FIELD } = sandbox;

// vm-sandbox objects have a foreign prototype -> compare by field, not identity.
function sameShape(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  assert.deepEqual(ka, kb, "key sets differ");
  for (const k of kb) assert.equal(a[k], b[k], `field ${k}`);
}

const complete = { "pilot-role": "FIRST_OFFICER", "rate-hourly": "480" };

// ---------------------------------------------------------------- shown / skipped

test("brand-new browser (empty store) -> profile incomplete -> onboarding shown", () => {
  assert.equal(isProfileComplete({}), false);
});

test("valid existing profile -> complete -> onboarding skipped", () => {
  assert.equal(isProfileComplete(complete), true);
  assert.equal(isProfileComplete({ "pilot-role": "CAPTAIN", "rate-hourly": "0" }), true); // 0 is valid
});

test("partial legacy settings (rates but no role) -> incomplete, values preserved for prefill", () => {
  const legacy = { "rate-hourly": "512.5", "rate-transport": "58", "drive-time-minutes": "40" };
  assert.equal(isProfileComplete(legacy), false); // no role -> onboarding
  const p = profileFromStore(legacy);
  assert.equal(p.hourlyRate, 512.5);
  assert.equal(p.travelReimbursement, 58);
  assert.equal(p.commuteMinutes, 40);
  assert.equal(p.role, null);
});

// ---------------------------------------------------------------- validation

test("invalid required values cannot complete onboarding", () => {
  assert.equal(validateOnboarding({ role: null, hourly: "480" }).ok, false); // no role
  assert.equal(validateOnboarding({ role: "FIRST_OFFICER", hourly: "" }).ok, false); // no hourly
  assert.equal(validateOnboarding({ role: "FIRST_OFFICER", hourly: "-5" }).ok, false); // negative
  assert.equal(validateOnboarding({ role: "FIRST_OFFICER", hourly: "abc" }).ok, false); // NaN
  assert.equal(validateOnboarding({ role: "PILOT", hourly: "480" }).ok, false); // bad enum
});

test("valid onboarding input -> ok, with the exact normalized shape", () => {
  const r = validateOnboarding({ role: "CAPTAIN", hourly: "650", seniority: "", travel: "60.5", commute: "35.6" });
  assert.equal(r.ok, true);
  sameShape(r.normalized, {
    role: "CAPTAIN",
    hourlyRate: 650,
    seniorityAddition: null, // blank optional -> null (not written)
    travelReimbursement: 60.5,
    commuteMinutes: 36, // rounded to a non-negative integer
  });
});

test("commute is stored as a non-negative integer number of minutes", () => {
  assert.equal(validateOnboarding({ role: "CAPTAIN", hourly: "1", commute: "42.7" }).normalized.commuteMinutes, 43);
  assert.equal(validateOnboarding({ role: "CAPTAIN", hourly: "1", commute: "-3" }).ok, false);
  assert.equal(profileFromStore({ ...complete, "drive-time-minutes": "40.9" }).commuteMinutes, 41);
});

// ---------------------------------------------------------------- persistence / migration

test("Captain selection persists to the authoritative key", () => {
  const s = applyProfileToStore({}, validateOnboarding({ role: "CAPTAIN", hourly: "650" }).normalized);
  assert.equal(s["pilot-role"], "CAPTAIN");
  assert.equal(profileFromStore(s).role, "CAPTAIN");
});

test("First Officer selection persists", () => {
  const s = applyProfileToStore({}, validateOnboarding({ role: "FIRST_OFFICER", hourly: "480" }).normalized);
  assert.equal(s["pilot-role"], "FIRST_OFFICER");
});

test("salary fields persist to the SAME keys the Settings inputs use (no parallel store)", () => {
  sameShape(PROFILE_FIELD, {
    role: "pilot-role",
    hourly: "rate-hourly",
    seniority: "seniority-value",
    travel: "rate-transport",
    commute: "drive-time-minutes",
  });
  const s = applyProfileToStore({}, validateOnboarding({ role: "CAPTAIN", hourly: "500", seniority: "1200", travel: "55" }).normalized);
  assert.equal(s["rate-hourly"], "500");
  assert.equal(s["seniority-value"], "1200");
  assert.equal(s["rate-transport"], "55");
});

test("reload restores the profile (store round-trips through the view)", () => {
  const n = validateOnboarding({ role: "CAPTAIN", hourly: "512.5", seniority: "900", travel: "58", commute: "40" }).normalized;
  const p = profileFromStore(applyProfileToStore({}, n));
  sameShape(p, {
    version: 1, role: "CAPTAIN", hourlyRate: 512.5, seniorityAddition: 900, travelReimbursement: 58, commuteMinutes: 40,
  });
});

test("migration: onboarding pre-fills every already-known value, needs only role", () => {
  const legacy = { "rate-hourly": "503.19", "rate-transport": "58.41", "seniority-value": "0", "drive-time-minutes": "30" };
  assert.equal(isProfileComplete(legacy), false);
  // user picks a role, keeps the pre-filled numbers
  const s = applyProfileToStore(legacy, validateOnboarding({
    role: "FIRST_OFFICER", hourly: "503.19", seniority: "0", travel: "58.41", commute: "30",
  }).normalized);
  assert.equal(isProfileComplete(s), true);
  assert.equal(s["rate-hourly"], "503.19"); // preserved
  assert.equal(s["rate-transport"], "58.41");
});

// ---------------------------------------------------------------- reset

test("reset profile removes ONLY the profile keys — roster + other settings survive", () => {
  const s = {
    "pilot-role": "CAPTAIN", "rate-hourly": "650", "seniority-value": "1000",
    "rate-transport": "55", "drive-time-minutes": "40",
    "rate-perdiem": "85", "fx-rate": "3.05", "home-base": "TLV", "backend-url": "", "route-estimates": "TLV-BUD: 3.4",
  };
  const after = stripProfileKeys(s);
  assert.equal(after["pilot-role"], undefined);
  assert.equal(after["rate-hourly"], undefined);
  assert.equal(after["seniority-value"], undefined);
  assert.equal(after["rate-transport"], undefined);
  assert.equal(after["drive-time-minutes"], undefined);
  // untouched:
  assert.equal(after["rate-perdiem"], "85");
  assert.equal(after["fx-rate"], "3.05");
  assert.equal(after["home-base"], "TLV");
  assert.equal(after["route-estimates"], "TLV-BUD: 3.4");
  assert.equal(isProfileComplete(after), false); // -> onboarding reappears
});

test("stripProfileKeys never references the roster storage key", () => {
  assert.equal(stripProfileKeys.toString().includes("crewboard-roster"), false);
  assert.equal(stripProfileKeys.toString().includes("ROSTER_STORE_KEY"), false);
});

// ---------------------------------------------------------------- privacy: no profile data leaves the device

test("POST /v1/watch body carries no personal-profile data", () => {
  const src = extractFn(html, "fsRegisterLegs");
  for (const bad of ["pilot-role", "rate-hourly", "seniority-value", "rate-transport", "drive-time-minutes", "profileFromStore", "crewboard-fields", "PROFILE_FIELD"]) {
    assert.equal(src.includes(bad), false, `fsRegisterLegs must not reference ${bad}`);
  }
  // the body is exactly the flight identity (+ provably-UTC schedule)
  assert.match(src, /num:\s*id\.num,\s*date:\s*id\.date,\s*from:\s*id\.from,\s*to:\s*id\.to,\s*\.\.\.legScheduledUtc\(l,\s*id\)/);
});

test("GET /v1/flight query carries no personal-profile data", () => {
  const src = extractFn(html, "fsReadOne");
  for (const bad of ["pilot-role", "rate-hourly", "seniority-value", "rate-transport", "drive-time-minutes", "crewboard-fields"]) {
    assert.equal(src.includes(bad), false, `fsReadOne must not reference ${bad}`);
  }
});

// ---------------------------------------------------------------- public build hygiene

test("public template contains NO personal default values", () => {
  const t = readFileSync(TEMPLATE, "utf8");
  for (const secret of ["503.19", "58.41", 'id="rate-perdiem" value="85"']) {
    assert.equal(t.includes(secret), false, `template leaked ${secret}`);
  }
  // profile inputs ship at neutral defaults
  assert.match(t, /id="rate-hourly" value="0"/);
  assert.match(t, /id="rate-transport" value="0"/);
  assert.match(t, /id="seniority-value" value="0"/);
  assert.match(t, /id="drive-time-minutes" value="0"/);
  // role select defaults to unset, no <option ... selected>
  assert.match(t, /<select id="pilot-role"[\s\S]*?<option value="">Select…<\/option>/);
  assert.equal(/<option value="(CAPTAIN|FIRST_OFFICER)"[^>]*selected/.test(t), false);
});

test("index.html is byte-identical to crewboard-template.html", () => {
  assert.ok(readFileSync(TEMPLATE).equals(readFileSync(INDEX)));
});

test("crewboard.html is git-ignored (never shipped publicly)", () => {
  assert.equal(execSync("git check-ignore crewboard.html || true", { cwd: repo }).toString().trim(), "crewboard.html");
});

// ---------------------------------------------------------------- onboarding does not touch the salary engine

test("onboarding/profile code does not redefine any salary-engine identifier", () => {
  // The onboarding block lives between these markers in the shipped file.
  const a = html.indexOf("Personal profile / first-run onboarding");
  const b = html.indexOf("Offline support", a);
  assert.ok(a > 0 && b > a);
  const block = html.slice(a, b);
  for (const engineFn of [
    "function computeCreditCore", "function calcCreditBreakdown", "function computeIncomeForDataset",
    "function computeIncentiveDetail", "function resolveLegBlock", "function countFlightDays",
    "function computeActivityDayIndices", "function countTransportUnits", "function countPerDiemUnits",
    "STANDBY_UNIT =", "PAIDOFF_UNIT =", "MONTHLY_BLOCK_THRESHOLD =",
  ]) {
    assert.equal(block.includes(engineFn), false, `onboarding block must not contain ${engineFn}`);
  }
});
