// Req 2 — the ROSTER / SALARY / CALENDAR / SHARE / MORE bar stays visible at the
// bottom of the viewport while content scrolls. Smallest robust fix: the scroll
// region gets `min-height:0` (so the app shell can't overflow and carry the nav
// off-screen), the nav gets an explicit z-index, and content clearance is tied
// to a `--nav-h` token plus the safe-area inset.
//
// Static CSS assertions on crewboard-template.html. Run:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const html = readFileSync(join(repo, "crewboard-template.html"), "utf8");

const rule = (sel) => {
  const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}").exec(html);
  assert.ok(m, `no CSS rule for ${sel}`);
  return m[1];
};

test("--nav-h token is defined on :root", () => {
  assert.match(html, /--nav-h:\s*\d+px/);
});

test("the scroll region (main#main-content) has min-height:0 so the shell can't overflow", () => {
  const main = rule("main");
  assert.match(main, /min-height:0/);
  assert.match(main, /flex:1/);
  assert.match(main, /overflow-y:auto/);
});

test("content bottom padding = --nav-h + safe-area inset (last card never hidden)", () => {
  const main = rule("main");
  assert.match(main, /padding-bottom:calc\(var\(--nav-h\)\s*\+\s*env\(safe-area-inset-bottom\)\)/);
});

test("nav.tabs is pinned, has an explicit z-index, and keeps its safe-area padding", () => {
  const nav = rule("nav.tabs");
  assert.match(nav, /position:fixed/);
  assert.match(nav, /bottom:0/);
  assert.match(nav, /z-index:\s*\d+/);
  assert.match(nav, /env\(safe-area-inset-bottom\)/);
});

test("nav z-index sits above the toast and below the modal overlays", () => {
  const navZ = Number(/nav\.tabs\{[^}]*z-index:\s*(\d+)/.exec(html)[1]);
  const toastZ = Number(/\.toast\{[^}]*z-index:\s*(\d+)/.exec(html)[1]);
  const onbZ = Number(/\.onb-overlay\{[^}]*z-index:\s*(\d+)/.exec(html)[1]);
  const reviewZ = Number(/\.review-overlay\{[^}]*z-index:\s*(\d+)/.exec(html)[1]);
  assert.ok(navZ > toastZ, `nav ${navZ} should be above toast ${toastZ}`);
  assert.ok(navZ < onbZ && navZ < reviewZ, `nav ${navZ} should be below overlays (${reviewZ}, ${onbZ})`);
});

test("nav is a viewport-fixed bar, not an app-shell-relative one (superseded — was 'absolute')", () => {
  const nav = rule("nav.tabs");
  assert.equal(/position:absolute/.test(nav), false);
});

test("switchTab still resets the scroll position and keeps the active-tab logic", () => {
  const start = html.indexOf("function switchTab(");
  const src = html.slice(start, html.indexOf("\n  }", start));
  assert.match(src, /getElementById\('main-content'\)[\s\S]*scrollTop = 0/);
  assert.match(src, /tab-btn\[data-tab="'\+navName\+'"\]/);
});
