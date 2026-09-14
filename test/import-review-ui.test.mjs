// Req 1 — the import Review is a viewport-height sheet whose "Apply Roster"
// action stays visible: it lives in a sticky/fixed footer, not appended after
// the (possibly very long) parsed-day list.
//
// Static assertions on the shipped crewboard-template.html — no DOM, no build.
//
// Run:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("review overlay markup exists with a dialog sheet, scroll body and footer", () => {
  assert.match(html, /<div class="review-overlay" id="review-overlay"/);
  assert.match(html, /<div class="review-sheet" id="review-sheet" role="dialog" aria-modal="true"/);
  assert.match(html, /<div class="review-scroll" id="review-panel"><\/div>/);
  assert.match(html, /<div class="review-foot">/);
});

test("Apply Roster + Cancel live in the footer, in that order", () => {
  const foot = html.slice(html.indexOf('<div class="review-foot">'), html.indexOf('<div class="review-foot">') + 400);
  assert.match(foot, /id="review-apply"[^>]*onclick="applyParsedRoster\(\)"[^>]*>Apply Roster</);
  assert.match(foot, /class="req-btn"[^>]*onclick="discardParsedRoster\(\)"[^>]*>Cancel</);
  assert.ok(foot.indexOf("Apply Roster") < foot.indexOf("Cancel"));
});

test(".review-scroll scrolls internally; .review-foot is fixed-height and honors the safe area", () => {
  const scroll = /\.review-scroll\{([^}]*)\}/.exec(html)[1];
  assert.match(scroll, /overflow-y:auto/);
  assert.match(scroll, /min-height:0/);
  assert.match(scroll, /flex:1 1 auto/);

  const foot = /\.review-foot\{([^}]*)\}/.exec(html)[1];
  assert.match(foot, /flex:none/);
  assert.match(foot, /env\(safe-area-inset-bottom\)/);

  const sheet = /\n\s*\.review-sheet\{([^}]*)\}/.exec(html)[1];
  assert.match(sheet, /flex-direction:column/);
  assert.match(sheet, /max-height:92dvh/);
});

test("showReview() puts ONLY the day list in the scroll body — Apply is not appended to it", () => {
  const src = extractFn(html, "showReview");
  assert.match(src, /getElementById\('review-panel'\)\.innerHTML = html/);
  // the buttons are static markup, never re-created inside the list html
  assert.equal(/innerHTML[^;]*Apply Roster/.test(src), false);
  assert.equal(src.includes("<button"), false);
  // opens the overlay and closes the manage sheet
  assert.match(src, /openOverlayModal\('review-overlay'/);
  assert.match(src, /closeManageSheet\(\)/);
});

test("apply / discard both close the overlay; parsing + rosterData shape untouched", () => {
  const apply = extractFn(html, "applyParsedRoster");
  const discard = extractFn(html, "discardParsedRoster");
  assert.match(apply, /closeReviewOverlay\(\)/);
  assert.match(discard, /closeReviewOverlay\(\)/);
  // apply still does exactly the original roster swap
  assert.match(apply, /rosterData\.length = 0;\s*pendingParsedDays\.forEach\(d => rosterData\.push\(d\)\);/);
  assert.match(apply, /saveRoster\(\);/);
});

test("no alert() / prompt() anywhere in the review path", () => {
  for (const fn of ["showReview", "applyParsedRoster", "discardParsedRoster", "closeReviewOverlay"]) {
    const src = extractFn(html, fn);
    assert.equal(/\balert\s*\(|\bprompt\s*\(/.test(src), false, `${fn} uses alert/prompt`);
  }
});

test("Escape / backdrop tap cancels the review", () => {
  const closeTop = html.slice(html.indexOf("window.closeTopOverlay = function"), html.indexOf("window.closeTopOverlay = function") + 400);
  assert.match(closeTop, /review-overlay[\s\S]*discardParsedRoster\(\)/);
  assert.match(html, /id="review-overlay" onclick="if\(event\.target===this\) discardParsedRoster\(\)"/);
});

test("the old inline #review-panel is no longer inside the manage sheet", () => {
  const sheet = html.slice(html.indexOf('id="manage-sheet"'), html.indexOf('id="manage-sheet"') + 1600);
  assert.equal(sheet.includes('id="review-panel"'), false);
});
