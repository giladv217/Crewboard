# CrewBoard

A single-file HTML/CSS/JS mobile-style app (no build step, no backend) that predicts an airline
pilot's salary from their roster, and reconciles that prediction against real payroll exports.
Built for an Israir A320 First Officer over a very long iterative session in Claude.ai chat before
moving to this repo. This file exists so a fresh Claude Code session starts with the same hard-won
context that session ended with — read it before making changes, not after something breaks.

## Files — source-of-truth architecture (post source-of-truth cleanup)

CrewBoard used to be maintained as two full hand-edited copies (`crewboard.html` and
`crewboard-template.html`) that had to be kept in sync by hand. That drifted badly and
repeatedly — most recently the entire C4b-2..4b-4b calendar-sync engine existed only in
`crewboard.html` while the template was ~2000 lines behind. It has now been reconciled into a
single canonical source + deterministic build:

- **`crewboard-template.html` — the ONE canonical, hand-edited source of truth.** All application
  code (HTML/CSS/JS) lives here, including every feature. It ships with generic placeholder values
  (marked `TEMPLATE:`) at the handful of points that are genuinely personal. **Make all code edits
  here.** It carries a `<!-- CANONICAL SOURCE -->` banner at the top as a reminder.
- **`crewboard.html` — GENERATED, git-ignored, real/private.** Built from the canonical source by
  injecting real values from `crewboard-data.private.json` (also git-ignored). This is the file you
  actually open/use day to day. **Never hand-edit it** — edits will be silently lost on the next
  build. Carries a `<!-- GENERATED -->` banner.
- **`index.html` — GENERATED, tracked, public.** A byte-for-byte copy of the canonical source
  (which already ships placeholder data, so no injection is needed). Serves GitHub Pages. **Never
  hand-edit it either.**
- **`crewboard-data.private.json` — git-ignored.** The real values for the 5 personal anchors:
  `EXCLUDED`, `EILAT_CODE`, `HOLIDAY_DATES_BY_YEAR`, `AIRPORT_FLAG`, `AIRPORT_UTC_OFFSET`. That's
  it — everything else that used to be "personal" (`rosterData`, the route-estimate table, the
  hourly/per-diem/transport rate defaults) was de-personalized in an earlier pass (see "Roster/rate
  data is runtime-only" below) and no longer lives in any HTML source at all.
- **`scripts/build-crewboard.mjs`** — the deterministic build. `node scripts/build-crewboard.mjs`
  builds both outputs; `--private` / `--public` build just one; `--check` verifies both are up to
  date without writing anything (fails with a clear message if stale — this is what CI/tests use).
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — PWA support
  (installable, works offline once loaded over http/https at least once). Service workers don't
  register over `file://`, which is fine — a locally opened file has no server connection to lose.

**Workflow**: edit `crewboard-template.html` → run `node scripts/build-crewboard.mjs` → open the
freshly-built `crewboard.html` to try it for real → run `node --test`. `test/canonical-source.test.mjs`
fails loudly if the canonical file goes missing/corrupt, if an output has drifted from it (someone
hand-edited `index.html` or `crewboard.html` directly again), or if either private file leaked into
git.

## Roster/rate data is runtime-only (de-personalized, do not reintroduce)

A prior pass removed ALL real roster/rate data from the HTML sources entirely — it now lives only
in the browser's `localStorage`, entered by the user through the app's own UI:

- `rosterData` seeds as `[]` in every build. CrewBoard ships with NO roster; the empty-state UI
  ("Import your roster to get started") is intentional. Never seed a real or synthetic roster here.
- `rate-hourly` / `rate-transport` ship `value=""` with a `placeholder` hint (never a real number —
  a stray "0" could be mistaken for an actual rate and silently used).
- `DEFAULT_ROUTE_BLOCK_ESTIMATES` is `{}` everywhere; the Settings "Route Block-Hour Estimates"
  textarea ships empty. Per-pilot route estimates are entered by the user and kept in
  `localStorage` only.

Do not "fix" any of this by baking sample/real data back into the canonical source — it's
deliberate, not an oversight.

## Before making any change

1. **Read the whole file first** — don't guess at the architecture from a diff or a partial view.
   `crewboard-template.html` is 6000+ lines of heavily cross-referential JS.
2. **This file has multiple `<script>` tags** — external `pdf.js`/`xlsx.js` (empty `src=`, no
   inline content) plus one large inline script with all the real logic. If you ever write a
   syntax-check script that assumes "the first two script blocks," it will silently check the
   *empty* external tags and skip the real one — this exact mistake shipped several turns of
   undetected breakage once. Standard Claude Code edits (Edit tool on the canonical file) don't
   have this problem, but any custom verification script should filter for non-trivial block size
   before trusting a "syntax OK".
3. When removing a button/input/feature, grep for every reference to its `id` before calling it
   done — a past button merge left three dead references to a removed element that would have
   thrown on load if not caught by a full-file grep afterward.
4. After any edit, rebuild (`node scripts/build-crewboard.mjs`) and run `node --test` before
   considering the change done — several tests extract real shipped functions straight out of
   `crewboard-template.html` and will catch a broken anchor/shape immediately.

## Architecture overview

**Data model**: `rosterData` is an array of day objects, in chronological order. Each entry:

```js
{date: 'DD/MM', day: 'MON'|'TUE'|..., code: 'DUTY'|'OFF'|'OFFP'|'ROFF'|'SBSM'|'SBSE'|'INS'|'LAYOVER'|'CXL'|'PM'|'MEMO',
 report: 'HH:MM', debrief: 'HH:MM',              // DUTY only, local Israel time
 legs: [{flt, ac, from, to, time: 'HH:MM – HH:MM[⁺¹]', block: <decimal hours or null>}],  // DUTY only
 flatCredit: 8,                                   // optional override for 4-leg days (2 round trips)
 crew: [{name, position}],                        // optional, manually entered via 👥 button
 label: '...'}                                    // non-DUTY days
```

Leg `time` strings are always stored as UTC, even though `report`/`debrief` are local Israel time.
Shabbat detection converts UTC→Israel local internally (`toIsraelLocal`, +3h).

**The salary engine** (in order of composition):

- `computeCreditCore(days, opts)` — shared core. Takes any day-array (live `rosterData`, an
  uploaded actual-times file, or a temporary What-If copy) plus `{getUnsched, maxDateObj}`.
- `calcCreditBreakdown()` — thin wrapper: `computeCreditCore(rosterData, {getUnsched: <reads live
  DOM checkboxes>})`. Powers the live Salary tab.
- `computeIncomeForDataset(days, maxDateObj, getUnsched, overrides)` — wraps `computeCreditCore`,
  adds transportation/per-diem/seniority/₪ conversion. Used by the live Salary tab, the Fanfare
  reconciliation, and the What-If simulator. Pass `{includeSeniority: true}` explicitly where the
  Settings seniority figure should count — it does not default on (this was a real bug once: the
  reconciliation's Predicted side silently omitted seniority pay the live tab already included).
- `computeIncentiveDetail(days, maxDateObj, getUnsched)` — per-flight drill-down mirroring
  `computeCreditCore`'s multiplier logic line-for-line. Keep both in sync or the drill-down modal
  will disagree with the totals. Two UI entry points: `showIncentiveModal()` (Predicted vs. Actual,
  Fanfare table) and `showSalaryIncentiveModal()` (live-only, Salary tab).
- `getRouteEstimates()` / `resolveLegBlock(l, estimates)` — user-maintained `FROM-TO: hours`
  fallback for legs missing real block hours. **Every place summing leg block hours must go
  through `resolveLegBlock`, never read `l.block` directly** — the `flatCredit` day branch was
  found not doing this once. Estimated values must always render visibly marked (amber "~X.XXh
  est."), never blended silently with confirmed numbers. **The user has explicitly said: if a new
  destination shows up with no block hours, leave it to them to fill in — don't proactively
  research/estimate it. Only search for a route's typical flight time when they directly ask.**

## Official incentive numbering ("Inc N")

The airline has an official numbered incentive legend the user wants used in generated reports.
Note: the in-app drill-down reason chips deliberately no longer print the "Inc N" label (a later
mobile session decision) — they read `holiday (2×)`, `unscheduled flight`, etc. The legend below
is still the reference for generated reports.

Confirmed mapping so far:

| Inc | Meaning | Payout | Implemented as |
|---|---|---|---|
| 1 | Activity on Shabbat | ? | generic "Shabbat window touched" — not distinguished from 9/15 |
| 2 | Simulator training on Saturday | 1.5x block hours (mechanism for a non-block INS day unclear) | not implemented |
| 3 | Activity on core holidays | flat 2x block credit | `holiday (2×)` |
| 4 | Exceeding 83 flight-hour monthly quota | +0.5×/hr on hours above 83 | "Monthly Overage Bonus" |
| 6 | Exceeding 13-day assignment quota | 1.5x from the 14th qualifying day | veteran multiplier — DUTY + LAYOVER + INS each count as one activity day (one credit per calendar day); standby / paid-off don't. A separate, stricter "Flight days: X/13" gauge counts DUTY-with-legs only. |
| 9 | Long-layover flights on Shabbat/holiday | ? | not distinguished from 1/15 |
| 10 | Two DUTY periods same calendar day | 1.5x on the 2nd | `2nd flight activity same day` |
| 11 | Unpublished flight / >3h change / added legs | 1.5x (2x if also Shabbat) | `unscheduled flight` |
| 12 | Schedule change, 7+ days notice | 1.5x block hours (possibly actually an exclusion clause, unconfirmed) | not implemented |
| 13 | Standby not activated, Shabbat/holiday | 1.5x (mechanism on top of flat 2.5h standby credit unclear) | not implemented |
| 14 | Worked >50% of period's Shabbats | 1.5x (scope unclear: all Shabbat flights or just the overage ones) | not implemented |
| 15 | Away from home Shabbat/holiday, not eligible for 9 | ? | not distinguished from 1/9 |

**Do not guess at Inc 1 vs 9 vs 15**, or at the exact payout mechanics of 2/12/13/14 — ask the user
rather than implementing a guess. "1.5x of block hours" doesn't have an obvious meaning for a
standby or ground-instruction day, which carry no block hours in this data model.

Inc 6 rule (confirmed): the "activity day" count that drives the 14th-day veteran multiplier and
the purple day-count badges (`computeActivityDayIndices`) counts DUTY, LAYOVER, and INS days —
one activity-day credit per calendar day. A layover day is a full activity day. Standby and
paid-off days never count.

This is deliberately NOT the same as the "Flight days this period: X/13" gauge (`countFlightDays`),
which is a stricter, flying-only count: DUTY days with real legs only (no LAYOVER, no INS). The two
used to be forced to agree; they are now intentionally separate rules — do not re-merge them.

History: earlier versions had the two counts disagreeing by accident (one included layover, the
other excluded instruction). They were briefly reconciled to "DUTY + INS, no LAYOVER" for both,
then corrected to the current split when the user confirmed a layover day does earn an
activity-day credit.

## Fanfare / AIMS reconciliation

Two genuinely different Excel export formats — detect which one before parsing, since loading the
wrong one through the wrong path once silently corrupted data (a Fanfare file loaded through the
main roster button produced a 35-hour "flight" from a misread duration column). The main roster
loader refuses a file with a `CurrentDataOps` sheet and points at the right button instead.

- **"Personal Schedule Report"** (single sheet, `Date | Duties | Details | Report times | Actual
  times/Delays | Debrief times | Crew`): `handlePdfUpload` (merged — also handles PDF, detects
  CSV/XLSX by extension). Times may be UTC or "Local Station" — check for `"All times in UTC"`
  text; if absent, convert via `localLegToUtc` using `AIRPORT_UTC_OFFSET`. **Do not use the
  source's own `⁺¹` day-crossing marker to force an extra +24h** — it describes a local-calendar-
  day difference between two time zones, which the UTC conversion already accounts for. Applying
  both double-counts the rollover (an 11.33h flight once became 35.33h this way). Trust only the
  natural `arrUTC < depUTC` check after conversion.
- **AIMS/Fanfare payroll workbook** (`CurrentDataOps`, `CurrentDataNFA`, `CurrentDataDuties`,
  `Report NFA`, `Report Pilot` sheets): `handleReconFileUpload` / `parseAimsWorkbook`.

Within the AIMS workbook, prefer the most authoritative source per figure over bottom-up
reconstruction:

- **Block hours per leg**: `ActualTakeOffTime`/`EndTime` via `computeUtcBlock`, not the separately
  indexed `BT_excel` column (a header-alignment issue once caused it to read a stray Shabbat-hours
  value instead).
- **Trip Time**: `Report NFA`'s per-day column, not `CurrentDataDuties.TT_excel` (the latter misses
  TT on pure layover days — a real 4.25h vs. 7.25h undercount was traced to this).
- **Completion top-up**: `CurrentDataDuties.TopUpHours_excel`.
- **Total payment**: `Report Pilot`'s own `סה"כ לתשלום` — read directly via
  `parseReportPilotSummary` and override the reconstructed total whenever present. The real pay
  structure is genuinely tiered (guaranteed base + marginal rate + separately-rated incentive
  component + separately-rated seniority component) — don't reverse-engineer a blended hourly
  rate from it, trust the sheet's own total.
- **Excel duration cells over 24h silently lose whole days** if read via `getUTCHours()` etc. — use
  `(val.getTime() - Date.UTC(1899,11,30)) / 3600000` instead (the `excelDurationToHours` helper
  already does this correctly; always route new duration reads through it, with a `capHours`
  plausibility check, never re-derive extraction inline).

## Reconciliation UX rules (user-stated)

- Not trying to hit ₪0 — only flag when Actual < Predicted by a meaningful margin (missed-
  incentive risk). Actual above Predicted isn't a problem.
- The comparison table live-updates on every "unscheduled" checkbox toggle
  (`renderReconComparison()`).

## What If simulator

`computeWhatIf()` previews a new flight offer's salary effect without touching the real roster.

- **A new offer replaces whatever was already scheduled that date** — filter out any existing
  entry sharing the date from the temporary copy before inserting the hypothetical day.
- **Checkbox lookups are reference-based, not index-based** — the temporary array has a different
  index layout past the insertion point than the live DOM. Build a `Map` from each live
  `rosterData` object to its real DOM index once; look up by identity, never by array position.
- Inserting/removing an activity day correctly ripples into the 14th-activity-day count for later
  days (both counting functions recompute fresh) — the result panel explicitly calls out any day
  whose veteran status flips, rather than leaving it invisible inside the total.

## Implicit layover detection

Some exports omit pure layover days entirely (no row for a day with nothing scheduled). This
silently undercounts both the 14-day tally and per-diem. `detectImplicitLayoverGaps()` finds gaps
between two DUTY entries landing/departing the same non-home city with unclaimed dates in between.
**Always show a review before inserting** — `fillImplicitLayovers()` → user confirms →
`applyImplicitLayovers()`. Never auto-apply; this changes real financial totals.

## Calendar/date-gap rendering

Both the Calendar tab (`renderCalendar`) and the family-sharing JPEG (`generateFamilyImage`) once
had the same bug independently: placing days by sequentially incrementing a column counter,
assuming zero gaps in `rosterData`. A missing day silently shifted every following day one column
left of its true weekday. Both fixed by computing each day's grid position from its real
day-of-month distance from the month's first tracked day, not by counting items. Use this same
approach for any future calendar-grid UI — the sequential-counter trap has bitten this codebase
twice already.

## Conventions

- Dates are `'DD/MM'` strings (no year); `ROSTER_YEAR` + `buildDateObj(dateStr, timeStr)` only
  where a real `Date` object is genuinely needed.
- LocalStorage for settings/persistence — fine here since the file runs directly in the user's own
  browser.
- The app is explicit and apologetic about its own approximations in the UI copy. Match that tone
  — this user has been burned by silent wrong numbers multiple times and values honesty about
  uncertainty over false precision. Where a formula or mapping is unconfirmed (see the Inc-number
  table), say so in the UI rather than guessing.
- **Design system**: dark "glass cockpit" navy background with cyan (PFD speed-tape blue) and
  amber (cockpit caution amber) accents is a deliberate, subject-appropriate identity — don't
  replace it wholesale. Space Grotesk (display) / IBM Plex Sans (body) / IBM Plex Mono (data)
  is a deliberate three-role type pairing for the same reason. A "more native" pass means refining
  execution (elevation shadows, native easing, press-states, `prefers-reduced-motion`, focus-
  visible rings), not replacing the color/type identity.
- Verify fixes against the user's real uploaded file data where possible — several bugs here only
  manifested on real files, never on hand-built test cases.
- No automatic sync exists anywhere in this workflow — not to GitHub, not to a Claude Projects
  knowledge base. Every environment (local file, GitHub Pages, Claude Code) is updated manually by
  the user. Don't imply otherwise.
