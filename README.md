# CrewBoard

Roster and salary-prediction app for an airline pilot (Israir A320 FO). Single-file HTML/CSS/JS,
no build step, no backend — runs entirely in the browser.

## Files

| File | What it is |
|---|---|
| `crewboard-template.html` | **The canonical source — edit this one.** All application code lives here, with generic placeholders at the few genuinely-personal spots. Tracked in git. |
| `crewboard.html` | GENERATED, git-ignored. Your real, personal build — built from the canonical source + `crewboard-data.private.json`. Open this to actually use the app. Never hand-edit it. |
| `index.html` | GENERATED, tracked. A byte-for-byte copy of the canonical source, used for GitHub Pages. Never hand-edit it. |
| `crewboard-data.private.json` | Git-ignored. Your real values for the handful of personal constants (home-base exclusions, holiday dates, airport flags/UTC offsets). |
| `scripts/build-crewboard.mjs` | Builds `crewboard.html` and `index.html` from the canonical source. |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | PWA support (installable + offline), used by whichever file you host online. |
| `CLAUDE.md` | Project context for Claude Code — architecture, past bugs and their fixes, open questions. Read automatically; you generally don't need to open it yourself. |

## Running it

1. Create `crewboard-data.private.json` (see `CLAUDE.md` for the shape) — one-time setup.
2. `node scripts/build-crewboard.mjs` — builds `crewboard.html` (and `index.html`).
3. Open `crewboard.html` directly in a browser, or double-click it locally. To use "Add to Home
   Screen" / offline support / a custom install icon, it needs to be served over http(s) rather
   than opened as a local file — GitHub Pages is a free way to do that (see below).

Made a code change? Edit `crewboard-template.html`, then re-run step 2 to rebuild both outputs.

## Publishing the clean version

1. Push this repo to GitHub (public is fine — `crewboard.html` and `crewboard-data.private.json`
   are git-ignored, see below)
2. `index.html` is already built and tracked at the repo root (rebuild it with
   `node scripts/build-crewboard.mjs --public` any time the canonical source changes)
3. In repo Settings → Pages, set Source to "Deploy from a branch", branch `main`, folder `/ (root)`
4. Your site is live at `https://<username>.github.io/<repo>/`

`.gitignore` already excludes `crewboard.html` and `crewboard-data.private.json` — they hold real
personal data and shouldn't be public. Nothing here syncs automatically: not to GitHub, not to a
Claude Projects knowledge base if you use one alongside this. Every update to any of those places
is a manual step (running the build script counts as manual — nothing runs it for you).

## Continuing development

Talk to Claude Code in this folder — it reads `CLAUDE.md` automatically and will already know the
app's architecture, the salary-calculation engine's structure, and a list of real bugs that were
already found and fixed once (worth not reintroducing). If something about the incentive-payout
rules (see the "Inc N" table in `CLAUDE.md`) is still marked unconfirmed, that's not a bug —
it's flagged that way on purpose because the exact rule wasn't verified yet. When you add a new
destination's block-hour estimate, the app leaves it to you to fill in rather than guessing — that
was a deliberate choice, not an oversight.
