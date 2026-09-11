#!/usr/bin/env node
// Deterministic build for CrewBoard's private/public HTML from ONE canonical,
// hand-edited, tracked source (crewboard-template.html).
//
// crewboard-template.html holds ALL application code (HTML/CSS/JS) plus generic
// placeholders (marked "TEMPLATE:") at the handful of points that are genuinely
// personal. Never hand-edit crewboard.html or index.html directly — both are
// generated from the canonical source and will be overwritten by this script.
//
// USAGE
//   node scripts/build-crewboard.mjs                 → builds both outputs
//   node scripts/build-crewboard.mjs --private        → crewboard.html only
//   node scripts/build-crewboard.mjs --public         → index.html only
//   node scripts/build-crewboard.mjs --check           → verify outputs are up
//                                                        to date; exit 1 + a
//                                                        clear message if not
//                                                        (writes nothing)
//
// --data <path>   private data file to inject (default: crewboard-data.private.json,
//                 git-ignored — see that file for the 5-key shape)
//
// PRIVATE build: canonical + crewboard-data.private.json -> crewboard.html
//   Each of the 5 known personal anchors in the canonical source is replaced
//   with the matching real value via an anchored, assert-found-or-throw
//   substitution (never a blind string search) — if the canonical source's
//   shape ever changes, this fails loudly instead of silently no-op'ing.
//
// PUBLIC build: canonical, byte-for-byte -> index.html
//   The canonical source already ships generic placeholders, so the public
//   build is a straight copy — no injection needed.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const CANONICAL = join(repo, "crewboard-template.html");
const PRIVATE_OUT = join(repo, "crewboard.html");
const PUBLIC_OUT = join(repo, "index.html");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valAfter = (f) => {
  const i = args.indexOf(f);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const DATA_PATH = valAfter("--data") || join(repo, "crewboard-data.private.json");

const doPrivate = has("--private") || (!has("--public") && !has("--check"));
const doPublic = has("--public") || (!has("--private") && !has("--check"));
const doCheck = has("--check");

function readCanonical() {
  if (!existsSync(CANONICAL)) {
    throw new Error(
      `build-crewboard: canonical source missing: ${CANONICAL}\n` +
      `This file is the single source of truth for CrewBoard's application code — it must exist and be tracked in git. Nothing can be built without it.`
    );
  }
  const html = readFileSync(CANONICAL, "utf8");
  if (!/<nav class="tabs">/.test(html) || html.length < 100000) {
    throw new Error(`build-crewboard: ${CANONICAL} does not look like the real CrewBoard app (too small / missing expected markup) — refusing to build from it.`);
  }
  return html;
}

// ---- anchored substitutions (canonical placeholder -> real value) ----------
// Each entry: a regex that must match the CANONICAL (placeholder) text exactly
// once, and a function producing the replacement from the private data object.
const ANCHORS = [
  {
    label: "EXCLUDED",
    re: /const EXCLUDED = \['EIL'\]; \/\/ TEMPLATE: set to your per-diem-excluded destination code\(s\)/,
    render: (d) => `const EXCLUDED = ${JSON.stringify(d.EXCLUDED)}; // per-diem-excluded destinations`,
  },
  {
    label: "EILAT_CODE",
    re: /const EILAT_CODE = 'EIL'; \/\/ TEMPLATE: set to your airline's short-hop\/low-minimum destination code, or '' if none/,
    render: (d) => `const EILAT_CODE = ${JSON.stringify(d.EILAT_CODE)};`,
  },
  {
    label: "HOLIDAY_DATES_BY_YEAR",
    re: /const HOLIDAY_DATES_BY_YEAR = \{\s*\n\s*\/\/ TEMPLATE: add confirmed holiday dates per year, e\.g\. 2026: \['11\/09','13\/09'\]\s*\n\s*\};/,
    render: (d) => {
      const entries = Object.entries(d.HOLIDAY_DATES_BY_YEAR || {})
        .map(([y, dates]) => `    ${y}: ${JSON.stringify(dates)}`)
        .join(",\n");
      return `const HOLIDAY_DATES_BY_YEAR = {\n${entries}\n  };`;
    },
  },
  {
    label: "AIRPORT_FLAG",
    re: /const AIRPORT_FLAG = \{\s*\n\s*\/\/ TEMPLATE: map each destination code you fly to, to its country flag emoji, e\.g\.:\s*\n\s*\/\/ JFK:'🇺🇸', BUD:'🇭🇺', ATH:'🇬🇷'\s*\n\s*\};/,
    render: (d) => {
      const entries = Object.entries(d.AIRPORT_FLAG || {}).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(", ");
      return `const AIRPORT_FLAG = {\n    ${entries}\n  };`;
    },
  },
  {
    label: "AIRPORT_UTC_OFFSET",
    re: /const AIRPORT_UTC_OFFSET = \{\s*\n(\s*\/\/[^\n]*\n)*\s*\};/,
    render: (d) => {
      const entries = Object.entries(d.AIRPORT_UTC_OFFSET || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
      return (
        `const AIRPORT_UTC_OFFSET = {\n` +
        `    // Current UTC offset in hours (summer/DST as applicable), for converting a Local Station\n` +
        `    // export's times to UTC so block hours can be computed same as a UTC export. Static and\n` +
        `    // approximate — doesn't auto-switch for winter clock changes.\n` +
        `    ${entries}\n` +
        `  };`
      );
    },
  },
];

function buildPrivateHtml(canonicalHtml, dataPath) {
  if (!existsSync(dataPath)) {
    throw new Error(`build-crewboard: private data file missing: ${dataPath}\nCreate it (git-ignored, never commit it) before building the private app. See crewboard-data.private.json's expected shape in CLAUDE.md.`);
  }
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  let html = canonicalHtml;
  for (const a of ANCHORS) {
    const m = a.re.exec(html);
    if (!m) throw new Error(`build-crewboard: anchor "${a.label}" not found in canonical source — its shape changed; update scripts/build-crewboard.mjs to match.`);
    html = html.slice(0, m.index) + a.render(data) + html.slice(m.index + m[0].length);
  }
  return html;
}

const banner =
  "<!-- GENERATED — do not edit. Produced by scripts/build-crewboard.mjs from\n" +
  "     crewboard-template.html (the canonical source). Edit that file instead,\n" +
  "     then re-run the build. -->\n";

const CANONICAL_BANNER_RE = /<!-- CANONICAL SOURCE[\s\S]*?-->\n/;

// The public output (index.html) must stay byte-identical to the canonical
// source — GitHub Pages serves it straight, and a test enforces the identity —
// so it is a pure copy, banner included, no rewriting at all.
function withGeneratedBanner(html) {
  const doctype = "<!DOCTYPE html>\n";
  if (!html.startsWith(doctype)) throw new Error("build-crewboard: canonical source does not start with <!DOCTYPE html>");
  const rest = html.slice(doctype.length).replace(CANONICAL_BANNER_RE, "");
  return doctype + banner + rest;
}

const canonicalHtml = readCanonical();

if (doCheck) {
  let ok = true;
  if (!existsSync(PUBLIC_OUT) || readFileSync(PUBLIC_OUT, "utf8") !== canonicalHtml) {
    console.error(`build-crewboard --check: ${PUBLIC_OUT} is stale or missing — run: node scripts/build-crewboard.mjs --public`);
    ok = false;
  }
  if (existsSync(DATA_PATH)) {
    const privateExpected = withGeneratedBanner(buildPrivateHtml(canonicalHtml, DATA_PATH));
    if (!existsSync(PRIVATE_OUT) || readFileSync(PRIVATE_OUT, "utf8") !== privateExpected) {
      console.error(`build-crewboard --check: ${PRIVATE_OUT} is stale or missing — run: node scripts/build-crewboard.mjs --private`);
      ok = false;
    }
  } else {
    console.error(`build-crewboard --check: ${DATA_PATH} not found — skipping the crewboard.html freshness check (fine for a fresh clone; needed before you build/open your real app).`);
  }
  process.exit(ok ? 0 : 1);
}

if (doPrivate) {
  const html = withGeneratedBanner(buildPrivateHtml(canonicalHtml, DATA_PATH));
  writeFileSync(PRIVATE_OUT, html);
  process.stderr.write(`build-crewboard: wrote ${PRIVATE_OUT} (${html.length} bytes)\n`);
}

if (doPublic) {
  // Pure copy — index.html must stay byte-identical to the canonical source.
  writeFileSync(PUBLIC_OUT, canonicalHtml);
  process.stderr.write(`build-crewboard: wrote ${PUBLIC_OUT} (${canonicalHtml.length} bytes)\n`);
}
