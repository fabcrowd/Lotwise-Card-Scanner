# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal Windows toolkit that identifies and prices Pokémon TCG cards from photos.
Plain-JS ESM Node server (dashboard + JSON API) plus a Python detect/identify sidecar
(VellumAI) and Chrome extensions. Integrates PokeGrade, VellumAI, TCGPlayer, JustTCG,
PokéWallet, RapidAPI, eBay, and Collectr.

Session continuity lives in `HANDOFF.md`, `tasks/todo.md`, the root `todo.md` (pricing
and extension proposal), and `tasks/lessons.md` — read them before proposing work.
`HANDOFF.md` summarizes task status; `tasks/todo.md` is the task history. The separate
`detector-upgrade-handoff.md` is a proposed plan with blockers, not a report of completed
work. Older dated handoffs are archived history in `docs/archive/`. Cursor conventions: `docs/autopilot/CURSOR.md`.

## Working model

The main session runs on Claude Fable 5.2 (`claude --model claude-fable-5-2`) at `high` effort. Use `xhigh` only for one hard, long piece of work where it measurably helps. Don't use `max`. If a session runs on Claude Opus 5.5 instead, start it at `medium` effort, the default on that model, and follow "Working on Claude Opus 5.5" in `~/.claude/CLAUDE.md`. Older notes call the main session "Opus": they mean the main-session role described here, whichever model runs it.

The main session researches, writes plans and briefs, reviews, verifies, and commits when the owner asks. Sonnet subagents (`builder`, `model: sonnet`) execute the plans: every code change, even one-liners. This is a token-saving measure: don't have the main session edit code or Sonnet invent plans. If a Sonnet agent hits a design decision not covered by its brief, it stops and reports instead of choosing. The main session writes its own documents itself: plans, briefs, handoffs, instruction files and memory notes.

Standing owner rule (2026-11-13): do the work through subagents or a dynamic workflow (a script that orchestrates many subagents, https://code.claude.com/docs/en/workflows), whichever makes the work easier to break up. The main session keeps its own work to getting the data and orchestrating. On this PC keep a workflow's concurrent agents low (memory is tight and the owner uses the machine during runs).

When to delegate: each subagent starts cold and reads again what the main session already knows, and subagents are a large share of a session's cost. Start one for a bounded edit, a test or harness run, a search across many files, or the same step over many items. Read a file, run one command or answer from context yourself: that is getting the data. A brief gives the goal, the file allowlist, the commands to run, what is out of scope, and what to report (paths and counts, not file dumps). Every change gets a cold `adversary` review before it is called done.

Ownership: the owner owns this code and wants surgical changes. Fix what is in scope. Report nearby problems instead of refactoring them. Review the diff, not only the builder's summary.

### Approvals

These steps need no approval. Do them without asking:
- `npm test`, `npm run lint`, single test files, the dist rebuild (`scripts/build-wasm-extension.ps1`, also with `-Store` or `-Sealed`) and Playwright specs.
- Offline Python scripts in `card-scanner-data` at below-normal priority with 8 threads or fewer.
- The real-world harness with an explicit dev pages file.
- Reads and searches, builder edits inside this working tree, and retries of reads, builds and tests.

Ordinary obstacles are not blockers: a timeout, a flaky Playwright port (EADDRINUSE: run the specs one at a time), a busy file, or a process stopped for low memory. Diagnose them and carry on.

These steps wait until the owner asks for that exact step in chat: a commit, a push, a merge to `main`, a push to `card-scanner-data`, a relay deploy, and `node scripts/sealed-score.mjs`. Prepare the change and name the one step you need. A general "go ahead" does not cover them.

Deliberate blockers are the sealed test set, the sets that have been viewed, preregistration before any model or threshold change, and a site that blocks a harvest (see Gotchas and `tasks/lessons.md`). Leave them alone and report what you found. Stop only for one of these or for an owner decision.

### Reports

Write final reports and handoffs for a reader who has not seen your tool calls. Put the result first, in plain full sentences. Then give the commands you ran and their results as evidence. Do not use a label you made up during the work without saying what it is.

---

## Where things live

Use this map with Glob/Grep to find code before reading any file.

Extension (the product), `tools/extension-wasm/`:
- `manifest.json`, `background.js` (service worker, ~3,000 lines), `popup.html`/`popup.js` (~1,900), `options.html`/`options.js`.
- `content.js` (~2,000) and `photo-detection.js`: page-side scripts, injected by the background (the manifest has no `content_scripts`).
- `lib/` detection and crops: `detect.js`, `rectify.js`, `corners.js`, `corner-read.js`, `frame-shadow.js`, `tiny-card.js`, `card-back.js`, `page-scan.js`, `page-focus.js`, `page-target.js`.
- `lib/` embedding and matching: `embed.js`, `search.js`, `adapter.js`, `refine.js`, `references.js`, `variant.js`, `variant-model.js`, `set-*.js`, `card-number.js`, `era.js`, `ocr.js`.
- `lib/` fusion and confidence: `fusion.js` (thresholds, confirm rule), `stakes.js`, `why.js`, `why-text.js`, `title-prior.js`, `page-prior.js`.
- `lib/` "is this a card" check and bundle: `not-card.js` (hidden entries), `bundle.js` (signed bundle), `assets/check.bin` and `assets/check.json`.
- `lib/` sharing and contributions: `contribution.js`, `sharing.js`, `share-rows.js`, `share-store.js`, `upload-queue.js`, `photo-id.js`, `shared-config.js`.
- `lib/` drawn boxes and overlay: `draw-box.js`, `drawn-examples-store.js` (dev build only), `overlay-toggle.js`, `overlay-remove.js`, `card-display.js`, `option-strip.js`.
- `lib/` pricing: `pricing.js`, `price-prefs.js`, `price-snapshot.js`, `condition-pricing.js`, `batch-price.js`, `ppt-key.js`.
- `lib/` corrections and choose flow: `choose-flow.js`, `card-picker.js`, `correction-*.js`, `corrections-store.js`, `memory-*.js`, `skip.js`, `lot-session.js`, `lot-export.js`.
- `lib/` setup and store config: `setup.js` (model download, cache), `site-access.js`, `net.js`, `gallery.js`, `rendition.js`, `photo-fetch.js`; `vendor/` is onnxruntime-web, `assets/` holds the check model, `icons/` the icons.

Build and packaging:
- `scripts/build-wasm-extension.ps1` builds `dist/extension-wasm`, `-wasm-sealed` and `-wasm-store` (plus the store zip); never hand-edit `dist/`.
- `scripts/lib/store-package.mjs`: the store transform (name, hosts, `STRIP_FILES`); `tools/extension-wasm-sealed/` is the sealed-score variant source.
- `scripts/build-installer.ps1` builds `dist/Lotwise-Setup-<version>.exe`, a per-user Windows installer made with IExpress that wraps the store package. Its scripts and guide page are in `tools/installer/` (`install.ps1`, `uninstall.ps1`, `guide.html`); `tests/installer.test.js` covers them. Chrome ignores `chrome://` addresses on its command line and loads an unpacked extension only by hand, so the installer copies the files and opens the guide.

Tests:
- `tests/*.test.js` (Node runner, one file per module). Contract pins: `store-build.test.js`, `store-clean.test.js`, `store-transform.test.js`, `extension-wasm-build.test.js`, `share-rows.test.js`, `share-queue.test.js`, `shared-data-pack.test.js`, `contribution.test.js`, `fusion.test.js`, `confirm-rule.test.js`, `bundle.test.js`, `packaged-check.test.js`, `relay-*.test.js`.
- `tests/e2e/` Playwright specs and `*.mjs` live scripts; `tests/fixtures/`, `tests/helpers/`; config in `playwright.config.js`.

Node server and sidecars:
- `src/index.js` (wiring), `src/server.js` (routes); `src/{identify,scan,pricing,photos,pokegrade,tcgplayer,ebay,collectr,server}/`.
- `tools/vellum-ai/`: Python sidecars `identify_server.py`, `server.py`, plus `detect/`, `vellum_ai/`, `catalog/`, `models/`, `tests/`, `scripts/`.
- `tools/chrome-extension/` older dev extension; `tools/labeler/` labeling tool.

Shared learning templates:
- `tools/relay/` (Cloudflare worker: `src/{handler,validate,cron,github,config,ids}.js`, `test/`).
- `tools/shared-data/` (Python `pipeline/` run, gate, signing, pack, train; `tests/`; `pins.json`).

Scripts worth knowing (`scripts/`):
- `realworld-run.mjs` real-world harness; `sealed-score.mjs` sealed totals; `references-dev-check.mjs`; `scan-pricing-smoke.mjs`; `bench-round*.mjs` older benchmarks; `lib/sealed-*.mjs` sealed-set helpers (never run against files in the sealed folder yourself).

Docs and continuity:
- `HANDOFF.md`, `docs/handoff-fable-5.2-hardening.md` (current), `tasks/todo.md`, `tasks/lessons.md`, `todo.md`, `detector-upgrade-handoff.md` (proposal, not a report). Archived history: `docs/archive/handoff-2026-10-24.md`, `docs/archive/handoff-2026-10-22-clip-v3.md`, `docs/archive/root-lessons.md`.
- `docs/plans/` (`shared-learning.md`, `self-learning.md`, `card-picker-and-sealed-test.md`, `launch.md`), `docs/store/` (listing, privacy policy, icons), `docs/blurry-training-plan.md`, `docs/known-limits.md`.

Data and scratch:
- `data/` is gitignored: `card-catalog/` (embeddings, id maps), `mercari-chrome-profile/`, `collectr-export.csv`. Do not open these. The rules below name `data/realworld/` and `data/extension-live-profile`; neither was present in this checkout on 2026-11-13.
- `data/sealed-test/` is off-limits (see Gotchas). `.tmp/` is gitignored scratch, including the realworld `PROFILE` copy.
- Sibling repo `C:\repos\projects\card-scanner-data`: `pipeline/` and `scripts/` (training, signing), `data/reports/<study>/README.md` (study results), `data/harvest-*.log`, `tasks/handoff.md`.

## Token discipline

- Find with this map and Glob/Grep first; read only the lines you need. `background.js`, `popup.js` and `content.js` are thousands of lines: Grep for the function, then read a short range.
- Do not read file contents under `dist/`, `node_modules/`, `data/`, `tools/vellum-ai/models/`, `.venv*`, model files (`*.bin`, `*.onnx`, `*.npy`, `*.faiss`) or screenshots under `tests/e2e/screenshots/`: they are generated, binary or large, and reading them spends tokens for nothing. Checking that a path exists is fine, and so is comparing `dist/` to source by timestamp or hash. `data/sealed-test/` is stricter: see Gotchas.
- Study numbers come from the result files and each study's `README.md` under `card-scanner-data/data/reports/`; never recompute them in the main session.
- Subagent reports and logs are summarized in a few lines, not pasted. Ask subagents for paths and counts, not file dumps.
- Run the single relevant test file while working; run the full `npm test` once at the end.
- Pull a harvest or run log through `Grep` for errors and the last lines; do not read it whole.

---

## 1. Commands

Shell is PowerShell: no `&&`, no bash heredocs; use `;` between commands.

```powershell
npm start                                  # node --env-file=.env src/index.js → http://127.0.0.1:3000
npm test                                   # node --test (all tests/*.test.js)
node --test tests/pricing.test.js          # single file; pass multiple files as separate args
node --test --test-name-pattern="<regex>" tests/pricing.test.js  # single test by name
npm run lint                               # eslint .

npm run vellum-ai                          # start VellumAI identify sidecar (prefers .venv312, then .venv)
npm run test:vellum                        # Python unittest suite in tools/vellum-ai/tests (uses .venv)

npx playwright test                        # E2E, headless Chromium (skips the extension specs listed in playwright.config.js)
npx playwright test --project=extension    # Chrome extension tests (headed, needs real Chrome)
npx playwright test --project=demo         # demo overlay (headed)
```

---

## 2. Architecture

### Processes
| Process | Entry | Port |
|---|---|---|
| Node dashboard / API | `src/index.js` → `src/server.js` | 3000 |
| VellumAI identify sidecar (CLIP + FAISS + detector) | `tools/vellum-ai/identify_server.py` | 8787 |
| Extension detect sidecar | `tools/vellum-ai/server.py` | 7331 |

The extension is the product: source in `tools/extension-wasm/` (tracked). `dist/extension-wasm*` is generated by
`scripts/build-wasm-extension.ps1` (default dev, `-Sealed`, `-Store`); never hand-edit `dist/` and rebuild before
Playwright or real-world runs, which load `dist/`. Fetch onnxruntime-web once with `scripts/setup_vendor.ps1`.
`tools/chrome-extension/` is the older dev extension that talks to the sidecar on port 7331.

### Wiring
- `src/index.js` reads env, constructs every client (`create*Client`), and passes them
  into `createServer({...})`. Nothing else reads `process.env` for wiring.
- Two identity resolvers are built from `src/identify/resolver.js`: one for
  `IDENTITY_MODE` (listing/inbox) and a separate `scannerIdentityResolver` for
  `SCANNER_IDENTITY_MODE` (`POST /api/scan` only). Modes: `dual | local-only | pokegrade-only`.
- Request flow: `POST /api/scan` (multipart via `src/server/multipart.js`) or `POST /detect`
  (JSON `{ image_b64 }`)
  → multi-card split (`src/photos/splitMultiCard.js`, VellumAI contours → rectified crops)
  → `src/scan/scanAndPrice.js` (identity → comps from pricing clients)
  → `src/pricing/pricing.js` rules → JSON price grid per card.
- `GET /api/price-grid` (JustTCG) is consumed by the extension when the server is up.

### Pricing rules (do not "simplify" away)
- Suggested price = median of available comps; `MIN_COMP_SOURCES = 2`.
- `needs_review` when any two comps differ by > `NEEDS_REVIEW_THRESHOLD` (15%), PokeGrade
  confidence is low, identity sources disagree, or VellumAI solo abstains.
- `PRICE_DRIFT_THRESHOLD` (5%) is a different rule: posted list price vs refreshed market.

---

## 3. Code Style and Patterns

### Module system
- All source is plain `.js` ESM — no TypeScript, no bundler. JSDoc is welcome.
- Node built-ins imported with `node:` prefix (`import http from 'node:http'`).

### Server
- Single `http.createServer` — no Express. Routes are an `if (method && pathname)` chain
  in `createServer`, dispatching to `async function handle*(req, res, deps)`.
- Responses always via `sendJson(res, status, data)`.
- Guard every injected dep:
  ```js
  if (typeof scanAndPrice !== 'function') return sendJson(res, 503, { error: '...' });
  ```
- Errors caught at route level; `RetryablePokegradeError` is checked with `instanceof`
  before the generic 500.

### Image processing
- Use `sharp` for image transforms; wrap calls in try/catch and fall back gracefully
  (see `imageMeanBrightness` in `src/server.js`). Prefer `.toBuffer()` over temp files.

### CORS
- Restricted to `chrome-extension://`, `http://127.0.0.1:3000`, `http://localhost:3000`,
  and `"null"`. Do not widen this allowlist.

### Tests (Node built-in runner)
- `import { test } from 'node:test'` and `assert from 'node:assert/strict'`.
- Integration tests spin up a real server with `server.listen(0)`; tear down in `finally`.
- No mocking framework — pass lightweight stub objects via DI.
- Git history follows RED/GREEN TDD commits (`test: add failing ...` then `feat: ... (GREEN)`).

---

## 4. Gotchas

### Identity
- `VELLUM_AI_ENABLED=false` by default — the sidecar must be running at `VELLUM_AI_URL`
  before enabling it.
- PokeGrade has a quota circuit breaker (`src/pokegrade/circuit.js`). When open, identity
  falls back to VellumAI solo. Reset via `POST /api/pokegrade-circuit/reset` or wait
  `POKEGRADE_CIRCUIT_TTL_HOURS`.
- PokeGrade 422 "could not identify a card" is a skip, not a retry.

### Scan retry logic (`src/server.js`)
- VellumAI abstain results are retried up to 2× with increasing JPEG quality before the
  preprocessing fallback chain: sharpen → CLAHE+sharpen → rotate 180° → tile split (3 tiles).
- A single detection, with or without `conf`, takes the single-card path on the original
  buffer and only borrows the sidecar's box; tile splitting runs only if that path abstains.
- Zero-confidence phantom detections are filtered (`c.conf >= 0.05` or absent). Do not
  remove — it prevents recursive re-detection explosion.

### Paths
- `serveScanPhoto` rejects `dir` containing `/` or `\`; `serveStatic` checks
  `resolved.startsWith(resolvedPublicDir)`. Always `path.resolve` before comparing.

### Environment
- `.env` is loaded via `--env-file=.env` (Node 20+). Do not add dotenv.
- Pricing needs at least one of `POKEWALLET_API_KEY` / `JUSTTCG_API_KEY` / `TCGPLAYER_PUBLIC_KEY`.
- Document new keys in `.env.example`. Do not rotate `PGAI_KEY` unless asked.
- Collectr has no public API: uses private `api-v2.getcollectr.com` with a JWT from browser
  `localStorage.collectrToken`; aggressive probing trips WAF 401s. CSV is the fallback.

### Data / models
- `data/` (catalog embeddings, card images, runtime state) and model weights are gitignored;
  regenerate per `tools/vellum-ai/README.md`. Keep `data/card-catalog/` private.
- Detector classes: `full_card` / `corner_closeup` / `card_back` — a corner close-up must
  never be used as a listing front.

### Sealed test set
- `data/sealed-test/` holds marketplace photos and labels that nothing may be tuned against.
  Never open, list, or search files there (`.claude/settings.json` and `.cursorignore` block it).
  Never tune code to per-photo results. Run `node scripts/sealed-score.mjs` only when the user asks;
  it prints totals, and those are the only numbers to report. It scores `dist/extension-wasm-sealed`
  (`scripts/build-wasm-extension.ps1 -Sealed`), the shipped code plus a source-URL check that also accepts
  `http://127.0.0.1`; the shipped build never does.

### Extension rules
- Store build: `tests/store-build.test.js` pins the exact permission and host list (`<all_urls>` is optional there). Adding a
  host, permission or relay/pack URL needs a deliberate test change, and dev-only code must not reach the store package.
- Confidence thresholds in `lib/fusion.js` (accept, abstain, `HIGH_TIER_SIM`/`HIGH_TIER_GAP`) are fitted to one model, crop and
  catalog. Refit them on labelled non-sealed data whenever any of the three changes; a score rise alone also needs refitting.
- Query crops must match how the catalog was embedded (`embed_all.py`): a stretch-vs-centre-crop mismatch was the biggest accuracy bug.
- Learning features (look-alike penalty, saved-correction ranking) stay off until a score shows a gain. Never tune to `data/sealed-test`.
- Real-world harness: `node scripts/realworld-run.mjs <pages.json>` always with an explicit pages file. Dev pages:
  `data/realworld/2026-10-16-p1/pages.json`. `data/realworld/fresh-pages.json` was used once (at a56c0e9) and is no longer blind;
  never read it for tuning. `PROFILE` must be a copy of `data/extension-live-profile` at `.tmp/realworld-profile`.
- Shared learning: `tools/relay` and `tools/shared-data` are templates the owner deploys. Never commit secrets or keys.
  The relay writes only to the `inbox` branch and must never touch code that runs with the signing key.
  `lib/shared-config.js` points at the live relay and bundle (c583710); changing it changes what every build talks to.
- Don't kill all `chrome.exe`: the user's own browser is running. Stop only processes you started.
- A Cursor agent may commit concurrently (87f2d0e was one). Run `git status` first and stage specific files.

### Native deps
- `sharp` ships a native binding; reinstall (`npm ci`) if `node_modules` crosses OS/arch.
