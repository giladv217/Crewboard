// Phase A adjustment — CrewBoard's home base is ALWAYS TLV.
//
// TLV is a company constant, not a user setting, not derived from the roster or
// the pilot directory. getHomeBase() is still the ONE accessor every runtime
// path (transport pay, per-diem / implied layovers, segment detection,
// timezone, destination lists) goes through — it just always returns TLV now.
//
// Static + extracted-function assertions on crewboard-template.html.
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
  const semi = src.indexOf(";", m.index);
  return src.slice(m.index, semi + 1);
}

// getHomeBase() / isHomeBaseConfigured() with a hostile DOM + storage: the
// result must STILL be TLV / true.
const sandbox = {
  String, JSON, RegExp,
  document: { getElementById: () => ({ value: "ZZZ" }) },       // a stray old input
  localStorage: { getItem: () => JSON.stringify({ "home-base": "JFK" }) }, // a stale stored value
};
vm.createContext(sandbox);
vm.runInContext(
  [
    extractConst(html, "HOME").replace(/^const /, "var "),
    extractFn(html, "getHomeBase"),
    extractFn(html, "isHomeBaseConfigured"),
  ].join("\n"),
  sandbox
);
const { getHomeBase, isHomeBaseConfigured, HOME } = sandbox;

test("HOME constant is TLV", () => {
  assert.equal(HOME, "TLV");
  assert.match(extractConst(html, "HOME"), /const HOME = 'TLV'/);
});

test("getHomeBase() returns TLV regardless of DOM value or stored value", () => {
  assert.equal(getHomeBase(), "TLV"); // sandbox feeds it "ZZZ" / "JFK" — both ignored
});

test("isHomeBaseConfigured() is always true (the base is always known)", () => {
  assert.equal(isHomeBaseConfigured(), true);
});

test("getHomeBase() no longer reads the #home-base input or the stored key", () => {
  const src = extractFn(html, "getHomeBase");
  assert.equal(src.includes("getElementById('home-base')"), false);
  assert.equal(src.includes("['home-base']"), false);
  assert.equal(src.includes("crewboard-fields"), false);
});

test("home-base is no longer a user-configurable field", () => {
  assert.equal(html.includes('id="home-base"'), false, "the #home-base input still exists");
  assert.equal(/<h2[^>]*>Home Base<\/h2>/.test(html), false, "the Settings 'Home Base' section still exists");
  const persisted = /const PERSISTED_FIELDS = \[([^\]]*)\]/.exec(html)[1];
  assert.equal(persisted.includes("'home-base'"), false, "home-base still in PERSISTED_FIELDS");
});

test("every base-dependent path still goes through getHomeBase() — nothing reads a raw field", () => {
  // transport pay, layover detection, segments, timezone, destination lists
  for (const fn of ["countTransportUnits", "detectImplicitLayoverGaps"]) {
    let src;
    try { src = extractFn(html, fn); } catch { continue; }
    assert.equal(/getElementById\(['"]home-base['"]\)/.test(src), false, `${fn} reads the raw field`);
  }
  // getHomeBase is still referenced widely (not orphaned / inlined away)
  assert.ok((html.match(/getHomeBase\(\)/g) || []).length >= 6);
});

// ---- header: TLV in the generic line only, never in the personalized one ----

vm.runInContext(
  [
    extractConst(html, "IDENTITY_FIELD").replace(/^const /, "var "),
    extractConst(html, "PROFILE_VERSION").replace(/^const /, "var "),
    extractConst(html, "PROFILE_FIELD").replace(/^const /, "var "),
    extractConst(html, "CREWBOARD_AIRCRAFT").replace(/^const /, "var "),
    extractConst(html, "INSTRUCTOR_KEY").replace(/^const /, "var "),
    extractFn(html, "profileFromStore"),
    extractFn(html, "headerFirstName"),
    extractFn(html, "deriveIdentityLine"),
  ].join("\n"),
  sandbox
);
const { profileFromStore, deriveIdentityLine } = sandbox;

test("generic fallback header uses TLV directly", () => {
  assert.equal(deriveIdentityLine(profileFromStore({ "pilot-role": "FIRST_OFFICER" }), getHomeBase()), "ISRAIR · FO A320 · TLV");
  assert.equal(deriveIdentityLine(profileFromStore({ "pilot-role": "CAPTAIN" }), getHomeBase()), "ISRAIR · CAPT A320 · TLV");
});

test("personalized header never contains TLV (or any base)", () => {
  const capt = profileFromStore({ "pilot-role": "CAPTAIN", "display-name": "PAT MORGAN" });
  const line = deriveIdentityLine(capt, getHomeBase());
  assert.equal(line, "PAT · CAPT · A320");
  assert.equal(line.includes("TLV"), false);
});

test("updateIdentityLine feeds the constant base, not a form value", () => {
  const src = extractFn(html, "updateIdentityLine");
  assert.match(src, /deriveIdentityLine\(profileFromStore\(_fieldsStore\(\)\),\s*getHomeBase\(\)\)/);
  assert.equal(src.includes("getElementById('home-base')"), false);
});
