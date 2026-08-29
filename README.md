# CrewBoard

Roster and salary-prediction app for an airline pilot (Israir A320 FO). Single-file HTML/CSS/JS,
no build step, no backend — runs entirely in the browser.

## Files

| File | What it is |
|---|---|
| `crewboard.html` | Your real, personal version — real name, employee data, real roster. Keep this local only. |
| `crewboard-template.html` | Clean, generic version with no personal data — safe to publish or share. |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | PWA support (installable + offline), used by whichever file you host online. |
| `CLAUDE.md` | Project context for Claude Code — architecture, past bugs and their fixes, open questions. Read automatically; you generally don't need to open it yourself. |

## Running it

No install needed — open `crewboard.html` directly in a browser, or double-click it locally. To
use "Add to Home Screen" / offline support / a custom install icon, it needs to be served over
http(s) rather than opened as a local file — GitHub Pages is a free way to do that (see below).

## Publishing the clean version

1. Push this repo to GitHub (public is fine — `crewboard.html` isn't included/tracked if you're
   sharing the repo; see `.gitignore` note below)
2. Rename or copy `crewboard-template.html` to `index.html` at the repo root
3. In repo Settings → Pages, set Source to "Deploy from a branch", branch `main`, folder `/ (root)`
4. Your site is live at `https://<username>.github.io/<repo>/`

**If you're pushing this whole folder to a public repo, add a `.gitignore` line for
`crewboard.html`** (or just don't commit it) — it has real personal data and shouldn't be public.

## Continuing development

Talk to Claude Code in this folder — it reads `CLAUDE.md` automatically and will already know the
app's architecture, the salary-calculation engine's structure, and a list of real bugs that were
already found and fixed once (worth not reintroducing). If something about the incentive-payout
rules (see the "Inc N" table in `CLAUDE.md`) is still marked unconfirmed, that's not a bug —
it's flagged that way on purpose because the exact rule wasn't verified yet.
