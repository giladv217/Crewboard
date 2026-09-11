// C4b-5 — in-app Google Calendar Sync UX.
//
// Covers the NEW connection/sync UI wired on top of the already-tested
// C4b-2..4b-4b engine (computeCalendarDiff / applyCalendarSyncDelta /
// showCalendarSyncReview are exercised by roster-import-c4b*.test.js in the
// aerodatabox-worker repo and by block-source-priority/onboarding tests here —
// this file does NOT re-test parser/diff correctness).
//
// The central contract under test is the knownGeneration semantics: it means
// "the last server sync generation THIS DEVICE has successfully reconciled",
// never "merely fetched". See confirmCalendarSyncReview / runCalendarSync in
// crewboard-template.html.
//
// Real shipped functions extracted into a vm sandbox with a fake DOM/
// localStorage/fetch — no framework, no real network, no real Google.
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
const TEMPLATE = join(repo, "crewboard-template.html");
const html = readFileSync(TEMPLATE, "utf8");

function extractFn(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`function ${name} not found`);
  // extractFn is used both for plain regex inspection (async keyword doesn't
  // matter) and for actually vm-executing the function (it does) — always
  // restore it so `await sandbox.someAsyncFn()` works.
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
  return src.slice(m.index, src.indexOf(";", m.index) + 1);
}

// ---------------------------------------------------------------- fake DOM

function fakeEl() {
  const classes = new Set();
  return {
    hidden: false, disabled: false, textContent: "", innerHTML: "", className: "",
    dataset: {}, style: {}, scrollTop: 0,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {},
  };
}
function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

// Builds one fresh sandbox with every C4b-5 function + its C4b-2..4b-4b
// dependencies wired as controllable stubs (never the real engine — that's
// covered elsewhere), plus the pieces needed to also exercise runCalendarSync.
function buildSandbox() {
  const store = makeStore();
  const els = {};
  const calls = { toasts: [], refreshCalendarConnect: 0, reviewShown: null };
  const sandbox = {
    // A no-op stand-in for the "tap again to arm" reset timer — these tests
    // exercise the double-tap logic itself (see disconnectCalendar below),
    // never the cosmetic label revert after 4.3s, so nothing needs to fire.
    console, JSON, Math, String, Number, Object, Array, isNaN, Date, URLSearchParams,
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: store,
    document: { getElementById: (id) => (els[id] || (els[id] = fakeEl())) },
    window: {},
    location: { href: "", hash: "", pathname: "/", search: "" },
    history: { replaceState() {} },
    showToast: (msg) => calls.toasts.push(msg),
    renderRoster() {}, renderCalendar() {}, renderNextDuty() {}, renderAvailableWindows() {}, renderFTL() {}, recalcSalary() {},
    refreshCalendarConnect() { calls.refreshCalendarConnect++; },
    getBackendBase: () => "https://worker.example",
    closeImportChooser() {},
    rosterData: [],
  };
  // The real page relies on `window.foo = ...` also creating a bare global
  // `foo` (true in a browser, where `window` IS the global object) — a plain
  // object stand-in for `window` doesn't do that, so mirror both explicitly.
  sandbox.openOverlayModal = sandbox.window.openOverlayModal = () => {};
  sandbox.closeOverlayModal = sandbox.window.closeOverlayModal = () => {};
  vm.createContext(sandbox);
  vm.runInContext(
    [
      extractConst(html, "CAL_KNOWN_GEN_KEY").replace(/^const /, "var "),
      extractFn(html, "getKnownCalendarGeneration"),
      extractFn(html, "setKnownCalendarGeneration"),
      extractFn(html, "clearKnownCalendarGeneration"),
      extractFn(html, "isCalendarDevMode"),
      extractFn(html, "_calEsc"),
      extractFn(html, "_calFmtWhen"),
      extractFn(html, "countTrackedCalendarDuties"),
      extractFn(html, "_calOauthErrorMessage"),
      extractFn(html, "_calSyncErrorMessage"),
      extractFn(html, "renderCalendarConnect"),
      extractFn(html, "disconnectCalendar"),
      extractFn(html, "selectCalendarChoice"),
      extractFn(html, "runCalendarSync"),
      "var _pendingCalendarDiff = null;",
      "var _pendingCalendarGeneration = null;",
      "var _calSyncInFlight = false;",
      "var _calDisconnectArmedAt = 0;",
      "var _calConnectStatus = null;",
      extractFn(html, "_closeCalSyncOverlay"),
      extractFn(html, "discardCalendarSyncReview"),
      extractFn(html, "confirmCalendarSyncReview"),
    ].join("\n"),
    sandbox
  );
  sandbox._calls = calls;
  sandbox._els = els;
  return sandbox;
}

// ============================================================== knownGeneration (user constraint 1)

test("A. cancelling a review never advances knownGeneration", () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(5);
  sb._pendingCalendarDiff = { hasConflicts: false };
  sb._pendingCalendarGeneration = 6; // a real sync fetched a newer generation
  sb.discardCalendarSyncReview();
  assert.equal(sb.getKnownCalendarGeneration(), 5);
  assert.equal(sb._pendingCalendarDiff, null);
  assert.equal(sb._pendingCalendarGeneration, null);
});

test("B. a clean confirm advances knownGeneration to the fetched candidate", () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(5);
  sb.applyCalendarSyncDelta = () => ({ ok: true, applied: { add: 1, update: 0, removedUpstream: 0, reappeared: 0, linked: 0, conflictSkipped: 0 } });
  sb._pendingCalendarDiff = { hasConflicts: false };
  sb._pendingCalendarGeneration = 6;
  sb.confirmCalendarSyncReview();
  assert.equal(sb.getKnownCalendarGeneration(), 6);
});

test("C. an apply failure leaves knownGeneration unchanged", () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(5);
  sb.applyCalendarSyncDelta = () => ({ ok: false, error: "validation_failed" });
  sb._pendingCalendarDiff = { hasConflicts: false };
  sb._pendingCalendarGeneration = 6;
  sb.confirmCalendarSyncReview();
  assert.equal(sb.getKnownCalendarGeneration(), 5);
  assert.ok(sb._calls.toasts.some((t) => /not applied/.test(t)));
});

test("D. confirming with unresolved conflicts (partial apply) leaves knownGeneration unchanged", () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(5);
  // applyCalendarSyncDelta itself succeeds (it applied the non-conflict ops
  // and skipped the rest) — the conflicts are what must gate the generation.
  sb.applyCalendarSyncDelta = () => ({ ok: true, applied: { add: 1, update: 0, removedUpstream: 0, reappeared: 0, linked: 0, conflictSkipped: 2 } });
  sb._pendingCalendarDiff = { hasConflicts: true };
  sb._pendingCalendarGeneration = 6;
  sb.confirmCalendarSyncReview();
  assert.equal(sb.getKnownCalendarGeneration(), 5);
});

test("E. a successful sync with zero actionable changes and zero conflicts may advance knownGeneration immediately", async () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(5);
  sb.fetch = async () => ({ ok: true, json: async () => ({ events: [{ id: "e1" }], calendarId: "cal1", syncGeneration: 7 }) });
  sb.getRosterImportProvider = (id) => (id === "aims-calendar" ? (async () => ({ activities: [{ fake: 1 }], removedUpstream: [] })) : null);
  sb.computeCalendarDiff = () => ({ operationalCount: 0, hasConflicts: false, counts: { add: 0, update: 0, removedUpstream: 0, unchanged: 3, linked: 0, reappeared: 0, conflict: 0 } });
  sb.showCalendarSyncReview = (diff) => { sb._calls.reviewShown = diff; };
  await sb.runCalendarSync();
  assert.equal(sb.getKnownCalendarGeneration(), 7);
  assert.equal(sb._calls.refreshCalendarConnect, 1);
  // Still shown for visibility (0 new / 0 changed / 3 unchanged) — persisting
  // the generation does not mean the review is skipped.
  assert.ok(sb._calls.reviewShown);
  assert.equal(sb._pendingCalendarGeneration, null); // nothing left pending to confirm
});

test("a sync producing real changes does NOT persist the candidate generation before confirm", async () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(5);
  sb.fetch = async () => ({ ok: true, json: async () => ({ events: [{ id: "e1" }], calendarId: "cal1", syncGeneration: 9 }) });
  sb.getRosterImportProvider = () => async () => ({ activities: [{ fake: 1 }], removedUpstream: [] });
  sb.computeCalendarDiff = () => ({ operationalCount: 1, hasConflicts: false, counts: { add: 1 } });
  sb.showCalendarSyncReview = (diff) => { sb._calls.reviewShown = diff; };
  await sb.runCalendarSync();
  assert.equal(sb.getKnownCalendarGeneration(), 5, "generation must wait for confirm");
  assert.equal(sb._pendingCalendarGeneration, 9);
  // Now confirm cleanly -> advances to the held candidate.
  sb.applyCalendarSyncDelta = () => ({ ok: true, applied: { add: 1, update: 0, removedUpstream: 0, reappeared: 0, linked: 0, conflictSkipped: 0 } });
  sb.confirmCalendarSyncReview();
  assert.equal(sb.getKnownCalendarGeneration(), 9);
});

test("zero AIMS events found: distinct message, and the generation still reconciles (nothing was missed)", async () => {
  const sb = buildSandbox();
  sb.fetch = async () => ({ ok: true, json: async () => ({ events: [], calendarId: "cal1", syncGeneration: 3 }) });
  sb.getRosterImportProvider = () => async () => ({ activities: [], removedUpstream: [] });
  await sb.runCalendarSync();
  assert.equal(sb.getKnownCalendarGeneration(), 3);
  assert.ok(sb._calls.toasts.some((t) => /no AIMS\/eCrew roster events were found/.test(t)));
});

test("a network error during sync touches neither the pending diff nor knownGeneration", async () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(5);
  sb.fetch = async () => { throw new Error("offline"); };
  await sb.runCalendarSync();
  assert.equal(sb.getKnownCalendarGeneration(), 5);
  assert.equal(sb._pendingCalendarDiff, null);
  assert.ok(sb._calls.toasts.some((t) => /Network error/.test(t)));
});

// ============================================================== calendar change / disconnect (constraint 2)

test("selecting a different calendar clears the device knownGeneration", async () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(42);
  sb.fetch = async () => ({ ok: true });
  await sb.selectCalendarChoice("cal2", "Second Calendar");
  assert.equal(sb.getKnownCalendarGeneration(), null);
  assert.equal(sb._calls.refreshCalendarConnect, 1);
});

test("disconnecting clears the device knownGeneration and touches no roster/history storage key", async () => {
  const sb = buildSandbox();
  sb.setKnownCalendarGeneration(42);
  const fetchedUrls = [];
  sb.fetch = async (url) => { fetchedUrls.push(url); return { ok: true }; };
  const btn = { textContent: "Disconnect", dataset: {} };
  await sb.disconnectCalendar(btn); // first tap only arms it
  assert.equal(sb.getKnownCalendarGeneration(), 42, "first tap must not disconnect yet");
  await sb.disconnectCalendar(btn); // second tap within the window actually disconnects
  assert.equal(sb.getKnownCalendarGeneration(), null);
  assert.ok(fetchedUrls.some((u) => /\/v1\/calendar\/disconnect$/.test(u)));
  assert.ok(sb._calls.toasts.some((t) => /disconnected/i.test(t)));
});

test("disconnectCalendar source never references the roster or calendar-history storage keys", () => {
  const src = extractFn(html, "disconnectCalendar");
  for (const bad of ["crewboard-roster", "crewboard-calendar-history"]) {
    assert.equal(src.includes(bad), false, `disconnectCalendar references ${bad}`);
  }
});

// ============================================================== rendering — never hardcode the calendar name

test("renderCalendarConnect renders the Worker-provided calendar name verbatim, never a hardcoded one", () => {
  const sb = buildSandbox();
  const el = sb.document.getElementById("cal-connect-body");
  sb.renderCalendarConnect({ connected: true, calendarSelected: true, calendarName: "Totally Custom Name 42", lastSyncAt: null });
  assert.match(el.innerHTML, /Totally Custom Name 42/);
  assert.equal(/CrewBoard01/.test(el.innerHTML), false);
});

test("static source check: no code path hardcodes 'CrewBoard01' or a primary-Gmail-style calendar name", () => {
  for (const fn of ["renderCalendarConnect", "selectCalendarChoice", "openCalendarPicker", "_renderCalendarPickerList"]) {
    const src = extractFn(html, fn);
    assert.equal(/CrewBoard01/.test(src), false, `${fn} hardcodes CrewBoard01`);
  }
});

test("state rendering: not connected / needs_reconnect / connected-no-calendar / calendar-selected", () => {
  const sb = buildSandbox();
  const el = sb.document.getElementById("cal-connect-body");

  sb.renderCalendarConnect({ connected: false });
  assert.match(el.innerHTML, /Connect your Google Calendar/);

  sb.renderCalendarConnect({ status: "needs_reconnect" });
  assert.match(el.innerHTML, /connection expired/);

  sb.renderCalendarConnect({ connected: true, calendarSelected: false });
  assert.match(el.innerHTML, /Google connected/);
  assert.match(el.innerHTML, /Choose calendar/);

  sb.renderCalendarConnect({ connected: true, calendarSelected: true, calendarName: "eCrew AIMS", lastSyncAt: "2026-05-01T10:00:00Z" });
  assert.match(el.innerHTML, /eCrew AIMS/);
  assert.match(el.innerHTML, /Sync now/);
  assert.match(el.innerHTML, /Change calendar/);
});

test("no backend URL configured shows a distinct, actionable message", () => {
  const sb = buildSandbox();
  const el = sb.document.getElementById("cal-connect-body");
  sb.renderCalendarConnect({ noBackend: true });
  assert.match(el.innerHTML, /Backend URL in Settings/);
});

// ============================================================== error messages (spec §18/19)

test("_calSyncErrorMessage maps known error classes to plain-English text, never a stack trace", () => {
  assert.match(sbErrMsg("not_connected"), /Connect your Google Calendar/);
  assert.match(sbErrMsg("no_calendar_selected"), /Choose a calendar/);
  assert.match(sbErrMsg("needs_reconnect"), /connection expired/);
  assert.match(sbSyncMsg(401, ""), /isn't recognized here/);
  assert.match(sbSyncMsg(502, "events_list_failed_502"), /problem on its end/);
  function sbErrMsg(code) { return extractAndRun("_calSyncErrorMessage", undefined, code); }
  function sbSyncMsg(status, code) { return extractAndRun("_calSyncErrorMessage", status, code); }
  function extractAndRun(name, a, b) {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(extractFn(html, name), sandbox);
    return sandbox[name](a, b);
  }
});

test("_calOauthErrorMessage never leaks the raw OAuth error code back to the user for unknown reasons", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extractFn(html, "_calOauthErrorMessage"), sandbox);
  assert.equal(sandbox._calOauthErrorMessage("some_raw_google_error_xyz"), "Please try again.");
  assert.match(sandbox._calOauthErrorMessage("access_denied"), /declined/);
});

// ============================================================== dev/testing path (constraint 3)

test("the dev paste-JSON button ships hidden by default and is not deleted", () => {
  assert.match(html, /id="calendar-paste-import-btn"[^>]*hidden/);
  assert.match(html, /function analyzeCalendarPaste\(/);
  assert.match(html, /function openCalendarPasteImport\(/);
});

test("the real Google Calendar entry point is the prominent one in the import chooser", () => {
  const chooseIdx = html.indexOf('id="import-choose"');
  const realIdx = html.indexOf("openCalendarConnect()", chooseIdx);
  const devIdx = html.indexOf('id="calendar-paste-import-btn"', chooseIdx);
  assert.ok(realIdx > -1 && devIdx > -1 && realIdx < devIdx, "the real Connect flow should be listed before the dev/testing path");
  assert.match(html.slice(realIdx, realIdx + 200), /recommended/);
});

test("isCalendarDevMode reads a dedicated, undocumented-to-users localStorage flag", () => {
  const sandbox = { localStorage: makeStore() };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(html, "isCalendarDevMode"), sandbox);
  assert.equal(sandbox.isCalendarDevMode(), false);
  sandbox.localStorage.setItem("crewboard-dev-mode", "1");
  assert.equal(sandbox.isCalendarDevMode(), true);
});

// ============================================================== credentials (Access remains the identity layer)

test("every /v1/calendar/* fetch sets credentials:'include' explicitly", () => {
  for (const fn of ["refreshCalendarConnect", "startGoogleConnect", "openCalendarPicker", "selectCalendarChoice", "runCalendarSync", "disconnectCalendar"]) {
    const src = extractFn(html, fn);
    if (!/\/v1\/calendar\//.test(src)) continue;
    assert.match(src, /credentials:\s*['"]include['"]/, `${fn} does not set credentials:'include' on its /v1/calendar/* fetch`);
  }
});

test("no calendar-sync UI code assumes credentials:'include' IS the auth mechanism (no client-side token/JWT handling)", () => {
  for (const fn of ["refreshCalendarConnect", "startGoogleConnect", "openCalendarPicker", "selectCalendarChoice", "runCalendarSync", "disconnectCalendar"]) {
    const src = extractFn(html, fn);
    for (const bad of ["Cf-Access-Jwt", "Authorization", "Bearer "]) {
      assert.equal(src.includes(bad), false, `${fn} references ${bad} — Access is the identity layer, the client must not manage it`);
    }
  }
});

// ============================================================== privacy (spec §20 / additional notes)

test("no calendar-sync UI function logs event descriptions, tokens, or roster JSON", () => {
  for (const fn of [
    "refreshCalendarConnect", "renderCalendarConnect", "startGoogleConnect", "openCalendarPicker",
    "_renderCalendarPickerList", "selectCalendarChoice", "runCalendarSync", "disconnectCalendar",
  ]) {
    const src = extractFn(html, fn);
    assert.equal(/console\.(log|debug|info|warn|error)/.test(src), false, `${fn} logs to the console`);
  }
});

test("runCalendarSync feeds the fetched body straight into getRosterImportProvider('aims-calendar') — no second sync model", () => {
  const src = extractFn(html, "runCalendarSync");
  assert.match(src, /getRosterImportProvider\(['"]aims-calendar['"]\)/);
  assert.match(src, /computeCalendarDiff\(/);
  assert.match(src, /showCalendarSyncReview\(/);
  assert.equal(/applyCalendarSyncDelta\(/.test(src), false, "runCalendarSync must not apply directly — only Confirm does, via the shared confirmCalendarSyncReview");
});
