# Pokémon Card Scanner

Personal Windows toolkit that finds Pokémon TCG cards in photos, names them and shows prices.

The product is a **Chrome extension** in [`tools/extension-wasm/`](tools/extension-wasm/). It scans the photos on a web page, names each card, and overlays the set and a price. The recognition models run in the browser (CLIP and YOLO through onnxruntime-web), so nothing needs to be running on this PC.

The repo also holds the older local toolkit that came first and still works:

- **Node dashboard and API** (`src/`, `public/`): upload a photo and get identity plus a price grid per card. It binds to the LAN, so a phone on the same Wi-Fi can use it. The extension's developer build can call it for per-condition JustTCG prices.
- **VellumAI** ([`tools/vellum-ai/`](tools/vellum-ai/README.md)): Python detect and identify sidecars (YOLO detector, CLIP and FAISS catalog retrieval, OCR), plus the catalog and detector training scripts.

Shared learning is an opt-in loop. The extension can send crops and corrections from photos you teach it, a Cloudflare Worker relay ([`tools/relay/`](tools/relay/)) stores them, and a nightly job ([`tools/shared-data/`](tools/shared-data/)) builds a signed bundle that the extension downloads. See [Shared learning](#shared-learning).

## Current status

This section follows `HANDOFF.md` ("Current state", 2026-11-14).

- The extension is at manifest version 3.1.0. Pull requests #2 and #3 were merged into `main` on 2026-11-14.
- The extension scans a page, names cards, lets you confirm or choose the printing, draw a box around a missed card and remove a card with an X. The price follows the card you pick and appears only once a card is confirmed.
- Sharing is opt-in and off by default. With it on, the extension also sends the boxes you drew, removed and put back, on photos you teach it.
- The relay and the nightly job are deployed. The nightly job counts the box signals and strips them before consensus, the exam and training, so nothing trains on them yet.
- No real box signal row has been sent yet; that is the remaining end-to-end check.
- The extension is not released. Only the owner's unpacked developer build exists, and the Chrome Web Store listing has not been submitted. The listing text and privacy policy are ready in [`docs/store/`](docs/store/).
- Open work and decisions are in [`HANDOFF.md`](HANDOFF.md) and [`docs/handoff-fable-5.2-hardening.md`](docs/handoff-fable-5.2-hardening.md).

## Browser extension

Source is `tools/extension-wasm/` (manifest version 3.1.0). `dist/` is generated: rebuild after changing source and never edit it by hand. Shell is PowerShell.

### Requirements

- Windows, PowerShell, and Chrome.
- Node.js 20 or later (the build and the tests run on it).
- Internet access once, for the model download and for `scripts/setup_vendor.ps1`.

### Build

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup_vendor.ps1                              # once: fetch onnxruntime-web into tools/extension-wasm/vendor
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1          # dev build -> dist/extension-wasm
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1 -Store   # store package -> dist/extension-wasm-store (+ zip)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1 -Sealed  # sealed-score variant -> dist/extension-wasm-sealed
```

### Load unpacked and first run

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `dist/extension-wasm`. On first launch the popup asks you to click **Download models** (about 147 MB, one time); **SCAN PAGE** stays off until that finishes. Full steps are in [`tools/extension-wasm/INSTALL.md`](tools/extension-wasm/INSTALL.md).

### Build variants

- **Dev** (`dist/extension-wasm`): keeps the localhost dashboard host permissions, test-photo collection and test hooks. When the dashboard is running, it uses `GET /api/price-grid` for per-condition JustTCG pricing.
- **Store** (`dist/extension-wasm-store`): drops those, requests `<all_urls>` only as an optional permission, and strips dev-only code. Its permission and host list is pinned by `tests/store-build.test.js`.
- **Sealed** (`dist/extension-wasm-sealed`): the shipped code plus a source-URL check that also accepts `http://127.0.0.1`. It exists only for `node scripts/sealed-score.mjs`, which you run only when asked. `data/sealed-test/` is off-limits for tuning.

### What it does today

- Scans a page, or a whole long page, and overlays name, set and price on each card it finds.
- Lets you confirm a guess or choose the card, including the printing (set and version) when several are close.
- Lets you draw a box around a card it missed.
- Lets you remove a card with the X, and bring back a box the "is this a card" check hid.
- Skips a card it cannot price instead of guessing a price.
- Copies or downloads the lot with one estimated lot value.
- Offers opt-in sharing, "Help improve recognition for everyone", which is off until you turn it on. See [`docs/store/privacy-policy.md`](docs/store/privacy-policy.md) for what is sent and [`docs/plans/shared-learning.md`](docs/plans/shared-learning.md) for the design.

The popup shows one price per card; condition chips (NM, LP, MP, HP, DMG) live in Settings. Confidence thresholds, the picker rules and the full-size photo upgrade are described in `CLAUDE.md` and `docs/plans/`.

### Shared learning

`tools/relay/` is a Cloudflare Worker that receives opted-in contributions and commits them to the data repo's `inbox` branch. `tools/shared-data/` is the nightly job that builds the signed bundle the extension downloads. Both are deployed. The data repo is `fabcrowd/card-scanner-data`. Setup steps are in [`tools/shared-data/README.md`](tools/shared-data/README.md). Never commit secrets or keys.

## Node dashboard and API

### Requirements

- Windows (the sidecar launch scripts look for `tools/vellum-ai/.venv312/Scripts/python.exe`, then `.venv`)
- Node.js 20 or later (uses native `--env-file`)
- Python for VellumAI, optional unless you use `local-only` or `dual` identity. `npm run vellum-ai` starts `tools/vellum-ai/identify_server.py` with the first venv it finds, `.venv312` then `.venv`; `npm run test:vellum` needs `tools/vellum-ai/.venv`. Venv and catalog setup are in [`tools/vellum-ai/README.md`](tools/vellum-ai/README.md).
- At least two pricing sources configured for prices to auto-accept (see [Pricing](#pricing--needs-review))

### Quick start

```powershell
npm install
copy .env.example .env
# Edit .env, see Configuration
npm start
```

Run these in the repo folder. The dashboard is at `http://127.0.0.1:3000` on this PC, or `http://<PC-LAN-IP>:3000` from a phone on the same Wi-Fi.

To identify locally, set up VellumAI first (see its README), set `VELLUM_AI_ENABLED=true`, then start the sidecar:

```powershell
npm run vellum-ai    # identify sidecar on http://127.0.0.1:8787
```

```text
Photo (single or multi-card spread)
  → multi-card detection: VellumAI detector → rectified crop per card
  → identity: PokeGrade ⊕ VellumAI (dual), VellumAI only (local-only), or PokeGrade only
  → comps: PokeGrade value, Collectr, TCGPlayer, eBay solds, JustTCG, PokéWallet, RapidAPI, pokemontcg.io
  → median price + needs-review flag → Scanner panel price grid per card
```

### Configuration

Copy [`.env.example`](.env.example) to `.env`. Variables read by the server:

#### Identity

| Variable | Purpose |
|----------|---------|
| `PGAI_KEY` | [PokeGrade](https://pokegrade.ai/developers) identification + market value |
| `VELLUM_AI_ENABLED` | Use the local VellumAI sidecar (default `false`) |
| `VELLUM_AI_URL` | Sidecar URL (default `http://127.0.0.1:8787`) |
| `VELLUM_AI_REQUIRE_OCR` | Sidecar-side: require OCR agreement before accepting a match (default `true`) |
| `IDENTITY_MODE` | `dual` (default) · `local-only` · `pokegrade-only` |
| `SCANNER_IDENTITY_MODE` | Override for `POST /api/scan` only. Defaults to `local-only` when VellumAI is enabled, else `IDENTITY_MODE` |
| `POKEGRADE_CIRCUIT_TTL_HOURS` | Auto-clear the PokeGrade quota circuit (default 24) |

#### Pricing sources

| Variable | Source |
|----------|--------|
| `JUSTTCG_API_KEY` | [JustTCG](https://justtcg.com/docs/quickstart): NM comps and the `/api/price-grid` response |
| `POKEWALLET_API_KEY` | [PokéWallet](https://www.pokewallet.io/api-docs): TCGPlayer USD comps |
| `TCGPLAYER_PUBLIC_KEY` / `TCGPLAYER_PRIVATE_KEY` | TCGPlayer official pricing API |
| `RAPIDAPI_KEY` | [RapidAPI Pokémon TCG](https://rapidapi.com/tcggopro/api/pokemon-tcg-api) (tcggo) comps |
| `RAPIDAPI_EUR_USD` | EUR→USD rate for RapidAPI prices (default `1.09`) |
| `POKEMON_TCG_API_KEY` | [pokemontcg.io](https://docs.pokemontcg.io): optional; raises the free-tier rate limit |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | eBay Marketplace Insights: median of last 5 sold items |
| `COLLECTR_TOKEN` / `COLLECTR_USER_ID` / `COLLECTR_COLLECTION_ID` | Collectr private api-v2 portfolio comps |
| `COLLECTR_API_BASE_URL` / `COLLECTR_SYNC_INTERVAL_MS` | Collectr api-v2 base URL and re-sync interval (default 6h) |
| `COLLECTR_CSV` / `COLLECTR_WATCH_PATH` | Collectr CSV fallback when no token is set |

#### Server

| Variable | Purpose |
|----------|---------|
| `HOST` / `PORT` | Bind address (default `0.0.0.0:3000`) |
| `DATA_DIR` | Runtime state + card catalog (default `data`) |

#### Collectr

Full guide: [`src/collectr/README.md`](src/collectr/README.md). Collectr has no public Partner API. The client uses the private web backend `api-v2.getcollectr.com` with the JWT from browser `localStorage.collectrToken` while logged into [app.getcollectr.com](https://app.getcollectr.com). Aggressive probing can trip WAF 401s, so back off and re-login. Without a token, comps come from the portfolio CSV at `COLLECTR_CSV`.

### Pricing / Needs review

Suggested price = median of all available comps.

A card is marked **needs review** when any of these hold:

- fewer than **2** comp sources returned a price
- PokeGrade confidence is low
- any two comps differ by more than **15%**
- identity sources disagree (PokeGrade vs VellumAI), or VellumAI abstains in solo mode

When the PokeGrade free-tier quota is exhausted, the app opens a **quota circuit**, skips further PokeGrade calls, and identifies with VellumAI solo. Reset it from the dashboard banner (`POST /api/pokegrade-circuit/reset`) or wait `POKEGRADE_CIRCUIT_TTL_HOURS`.

### API

| Route | Purpose |
|-------|---------|
| `POST /api/scan` | Multipart `photos` field → identity + comps + price decision (Scanner panel) |
| `POST /detect` | JSON `{ image_b64 }` → per-card detection, identity and price; retries + preprocessing fallbacks on abstain |
| `GET /api/price-grid?name=&set=&number=` | JustTCG per-condition grid (used by the extension) |
| `GET /api/identity-status` | Identity modes, VellumAI enabled/URL, circuit state |
| `POST /api/pokegrade-circuit/reset` | Close the PokeGrade quota circuit |
| `GET /api/collectr-status` | Collectr mode + sync stats |
| `GET /api/scan-photo` | Serve a saved scan crop |
| `GET /health`, `GET /api/health` | Liveness |

## Tests and checks

```powershell
npm test                                  # node --test (all tests/*.test.js)
node --test tests/pricing.test.js         # a single file
npm run lint                              # eslint
npm run test:vellum                       # VellumAI Python tests (tools/vellum-ai/.venv)
npx playwright test                       # E2E, headless Chromium (skips the extension specs listed in playwright.config.js)
npx playwright test --project=extension   # extension E2E (headed, needs real Chrome)
npx playwright test --project=demo        # demo overlay (headed)
```

Playwright and the real-world harness (`node scripts/realworld-run.mjs <pages.json>`, always with an explicit pages file) load `dist/`, so rebuild the extension first. The shared-data Python tests live in `tools/shared-data/tests/` and run with `unittest`.

## Where to read more

- [`HANDOFF.md`](HANDOFF.md): current state at the top.
- [`CLAUDE.md`](CLAUDE.md): rules, commands and gotchas for agents working in this repo.
- [`docs/handoff-fable-5.2-hardening.md`](docs/handoff-fable-5.2-hardening.md): the current hardening handoff.
- [`tasks/lessons.md`](tasks/lessons.md): corrections and non-obvious decisions.
- [`docs/store/`](docs/store/): store listing and privacy policy.
- [`docs/known-limits.md`](docs/known-limits.md): what the extension cannot do yet.
- [`CHANGELOG.md`](CHANGELOG.md): notable changes.
- The folder-by-folder file map is the next section.

## License

Private / personal use.

## Repository map (for LLM agents and new contributors)

Orientation:

- Read `CLAUDE.md` first: rules, commands, gotchas. Read the top section of `HANDOFF.md` ("Current state") for what is merged and live.
- Use this map with Glob and Grep before reading any file; read only the lines you need.
- `tools/extension-wasm/background.js`, `popup.js` and `content.js` are thousands of lines. Grep for the function, then read a short range.
- `dist/` is generated by `scripts/build-wasm-extension.ps1`. Never edit it by hand. Playwright and the real-world harness load `dist/`, so rebuild first.
- Never open `dist/`, `node_modules/`, `data/`, `tools/vellum-ai/models/`, `.venv*`, `.tmp/`, model files (`*.bin`, `*.onnx`, `*.npy`, `*.faiss`) or screenshots under `tests/e2e/screenshots/`.
- Never open, list or search `data/sealed-test/`, and never tune code to per-photo results from it. Run `node scripts/sealed-score.mjs` only when the user asks, and report only the totals it prints.
- Study numbers come from the result files and each study's `README.md` under the sibling repo `card-scanner-data` (`data/reports/`); never recompute them.
- Run the single relevant test file while working; run the full `npm test` once at the end. Shell is PowerShell: no `&&`.
- A Cursor agent may commit concurrently: run `git status` first and stage specific files.

Counts below are tracked files (729 in total).

### Top level

| Path | Purpose |
|---|---|
| `tools/` (345) | The extension (the product), the VellumAI sidecar, the relay, the shared-data pipeline, an older extension, a labeling tool |
| `tests/` (185) | `node:test` files, Playwright specs, fixtures, helpers |
| `scripts/` (54) | Build, vendor, benchmark, sealed-set and real-world scripts |
| `docs/` (44) | Plans, handoffs, store listing and privacy policy, archive, autopilot PRDs |
| `tasks/` (52) | Task history, lessons, research notes, QA smoke evidence in `tasks/qa-smoke/` |
| `src/` (28) | Node dashboard and JSON API (plain ESM, no framework) |
| `public/` (3) | Static dashboard: `index.html`, `app.js`, `styles.css` |
| `.claude/` (5) | Claude Code project settings, a scheduler lock file, two planning notes |
| `CLAUDE.md` | Agent rules, commands, "Where things live" |
| `HANDOFF.md` | Current state, next steps, decisions |
| `README.md` | This file |
| `CHANGELOG.md` | Notable changes |
| `todo.md` | Proposal: price condition grid, graded pricing, variant confirmation |
| `detector-upgrade-handoff.md` | Proposed detector upgrade plan with blockers (a proposal, not a report) |
| `package.json` | npm scripts (see Entry points), Node 20+, dependency `sharp`, dev dependencies `@playwright/test` and `eslint` |
| `playwright.config.js` | Playwright projects `chromium`, `extension`, `demo` |
| `eslint.config.js` | ESLint flat config |
| `.env.example` | Template of environment keys; copy to `.env` |
| `.cursorignore` | Cursor ignore list |

### Extension: `tools/extension-wasm/` (90 tracked files)

Chrome MV3 source. The manifest has no `content_scripts`; `content.js` and `photo-detection.js` are injected by the background.

Entry files (folder root):

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Service worker (about 3,000 lines): detection pipeline with onnxruntime-web on `globalThis.ort`, page scans, pricing, corrections |
| `popup.html`, `popup.js` | Popup markup and logic (`popup.js` about 1,900 lines; has `// dev-only:start` and `// dev-only:end` blocks) |
| `options.html`, `options.js` | Options page: PokemonPriceTracker key, price filters, site access (has dev-only blocks) |
| `content.js` | Page-side overlay (IIFE, guarded against double injection): boxes and labels over the scanned page |
| `photo-detection.js` | Page-side window detection of one upright card, or one tilted up to 45 degrees or lying sideways |
| `INSTALL.md` | Install steps for the unpacked extension |
| `assets/` | `check.bin` (the "is this a card" model) and `check.json` |
| `icons/` | 16, 48 and 128 px PNG icons |
| `vendor/` | onnxruntime-web files; not tracked, fetched by `scripts/setup_vendor.ps1` |

`lib/` (76 files). ESM modules imported by the background, popup, options or content script. File names below are under `tools/extension-wasm/lib/`.

Detection and crops:
- `detect.js`: YOLO card detection through onnxruntime-web (input 640, confidence and NMS constants).
- `rectify.js`: crops a detected box from the source bitmap into a 750x1050 card image.
- `corners.js`: second-stage model that finds the four corners of a card inside a detector box.
- `corner-read.js`: reads the collector number from the bottom corners of a card cut from the source picture.
- `frame-shadow.js`: scores the drop shadow of a crop (shadowless cards score 0).
- `tiny-card.js`: boxes below the minimum size are kept as unread entries, not dropped.
- `card-back.js`: decides whether a crop is the back of a card.
- `page-scan.js`: which screens to capture when a page is taller than the window, and which cards seen twice are one card.
- `page-focus.js`: which pictures on a page should be scanned (the listing photo, not thumbnails or similar items).
- `page-target.js`: which tab a scan reads, and which callers may ask for one.

Embedding and matching:
- `embed.js`: CLIP ViT-B-32 visual embedding through onnxruntime-web.
- `search.js`: brute-force cosine search over the catalog (`catalog.bin.gz`, L2-normalized float32).
- `adapter.js`: low-rank photo adapter applied to query and catalog embeddings.
- `refine.js`: second look at grid tiles the first read could not settle, using the page's larger picture (pure decisions; the background fetches and embeds).
- `references.js`: reference memory of the embeddings of crops the user corrected.
- `variant.js`: turns the variant model's three heads into the printing to price (an unsure head stays unset).
- `variant-model.js`: runs the trained variant classifier.
- `set-choice.js`: which printings of a recognized card the user should choose between.
- `set-codes.js`: set codes printed on Scarlet & Violet-era card faces, mapped to catalog sets.
- `set-prior.js`: soft prior from the sets most settled cards on the page come from.
- `set-stamp.js`: EX set-logo stamps (ex10 to ex16 reverse holos) in the bottom-right of the art.
- `set-symbol.js`: set symbol matching on real train photos.
- `set-symbol-templates.js`: grayscale set symbol templates cut from train photos.
- `set-totals.js`: printed card total per set; generated by `scripts/gen-set-totals.mjs`.
- `card-number.js`: reads the collector number (for example "88/132") and uses it to pick the printing.
- `ocr.js`: collector-number reader (RapidOCR PP-OCRv4 detector and recognizer) on the bottom strip of a rectified card.
- `era.js`: the era a lot comes from, chosen once by the user.
- `edition-stamp.js`: scores the 1st Edition stamp on crops.
- `first-edition-stamp.js`: grayscale 1st Edition stamp template.

Fusion and confidence:
- `fusion.js`: identity resolution over ranked CLIP hits; holds the confirm and accept thresholds.
- `stakes.js`: price never decides confirmation; holds `bestMatchPrice`, `unconfirmedTotal` and the non-state `isHighValue` flag.
- `choose-flow.js`: the two identification states, CONFIRMED and CHOOSE.
- `why.js`: the why-record of a confirmed card (what the scanner believed and why).
- `why-text.js`: plain-language "Why this card?" sentence built from a why-record.
- `title-prior.js`: uses the listing title as a weak hint that reorders matches.
- `page-prior.js`: best guesses for rows whose printing is still open, from the sets settled on the page.
- `memory-confirm.js`: what reference memory does to a fused read (confirm-level and negative memory).
- `reference-bars.js`: limits what a saved correction may do to a new scan, by read height.
- `batch-price.js`: batch pricing helpers for the scan path; touches nothing that confirms a card.

"Is this a card" check and bundle:
- `not-card.js`: hides, rather than drops, a box the check rejects; "Show it" brings it back.
- `bundle.js`: the signed community bundle; used only when signed by the owner and built for this build's CLIP model and crop; also reads the community pack (`parsePack`).

Sharing and contributions:
- `contribution.js`: contribution schema v1 (what the opt-in setting sends); holds `MAX_CARDS`, `BOX_KINDS` and the other limits.
- `sharing.js`: the opt-in "Help improve recognition for everyone" setting; off by default.
- `share-rows.js`: turns scan rows into contribution rows (pure).
- `share-store.js`: upload queue and downloaded bundle, in IndexedDB.
- `upload-queue.js`: sends queued contributions to the relay in batches, with longer waits after failures.
- `photo-id.js`: 64-bit difference hash of a photo; photos in the exam split are never learned from.
- `shared-config.js`: relay and bundle addresses; an empty string switches a feature off.

Drawn boxes and overlay:
- `draw-box.js`: pure parts of "Draw a box": maps the drawn rectangle to photo pixels and builds the entry.
- `drawn-examples-store.js`: developer build only; drawn boxes kept locally as training examples, never uploaded.
- `overlay-toggle.js`: the popup's "Show boxes on page" toggle.
- `overlay-remove.js`: removes a card from the scan and the lot total when its overlay X is clicked.
- `card-display.js`: what the popup and overlay may show as a price (no price for an unconfirmed card).
- `option-strip.js`: image-first pickers for printings, versions and finishes on a confirmed row.

Pricing:
- `pricing.js`: market price from pokemontcg.io with a 24-hour `chrome.storage.local` cache.
- `price-snapshot.js`: the nightly `prices.json`; a price replaces the TCGdex number only when the TCGPlayer product id is in the file.
- `condition-pricing.js`: per-condition and graded pricing (dev backend proxy, PokemonPriceTracker, pokemontcg.io fallback).
- `price-prefs.js`: (purpose not stated in the file); exports `DEFAULT_FILTERS` (raw conditions and graders) and `mergeFilters`.
- `ppt-key.js`: PokemonPriceTracker key in `storage.local`.

Corrections and choose flow:
- `correction-save.js`: saves a correction to the store (history, count, cap, full disk).
- `correction-state.js`: how saved corrections age (re-correction keeps history; repeats count; cap).
- `corrections-store.js`: saved corrections and recent scan pictures in IndexedDB.
- `card-picker.js`: ask-the-user logic: which cards to offer for a guess, and manual catalog search.
- `memory-ui.js`: memory chips on a row and the "Why this card?" panel markup (escaped).
- `skip.js`: "Can't price this" for cards the English catalog cannot name; keeps scan data, excludes from pricing.
- `lot-session.js`: the saved lot per page, kept 24 hours in `chrome.storage.session`.
- `lot-export.js`: the confirmed lot as rows for a sheet (pure).
- `test-photos.js`: test photo records (detector picture plus drawn boxes) for labeling; no identity or price.

Setup, network and site access:
- `setup.js`: model download and cache; holds `CACHE_NAME`, `ASSETS` and `OPTIONAL_ASSETS` (name, bytes, release, sha256).
- `net.js`: classifies host names as loopback, link-local, private or local-only.
- `site-access.js`: optional per-site access needed to read a page's full-size photo.
- `gallery.js`: other photos of a listing (a lot shot plus close-ups in a carousel or thumbnail strip).
- `rendition.js`: the largest rendition each listing site serves, matched by exact URL pattern.
- `full-size.js`: finds the larger rendition of a listing photo shown small on a page.
- `photo-fetch.js`: limits for reading a page photo from the network (bytes, time, decoded size, redirects).
- `tab-messaging.js`: messages to a page whose content script may not be injected yet.

### Node server: `src/` (28 files)

- `index.js`: wiring; builds every `create*Client` and starts the server.
- `server.js`: HTTP server and routes (one `http.createServer`, no framework).
- `collectr/`: `README.md` (how prices sync without a public API), `apiV2.js` (private api-v2 portfolio sync), `catalog.js` (parses the Collectr CSV, 24-hour stale window), `client.js` (api-v2 when `COLLECTR_TOKEN` is set, else CSV), `exportWatcher.js` (reloads the catalog when a newer export appears), `match.js` (identity normalization).
- `ebay/`: `auth.js` (OAuth client-credentials token), `solds.js` (sold-item comps, Marketplace Insights API).
- `identify/`: `resolver.js` (identity resolver; compare key `setCode|number`, else `name|set|number`), `types.js` (identity-source contract), `vellumAi.js` (VellumAI identity client; one JSON cache file keyed by image hash).
- `photos/`: `roles.js` (same-batch front and back roles), `shotKind.js` (full front, full back or close-up; heuristic), `splitMultiCard.js` (calls the sidecar's `/detect-multi` and writes each crop as a JPEG).
- `pokegrade/`: `circuit.js` (persisted quota circuit), `client.js` (PokeGrade value client; quota and rate-limit responses throw `QuotaExhaustedPokegradeError`, which the identity resolver turns into an open circuit).
- `pricing/`: `pricing.js` (rules: `MIN_COMP_SOURCES`, `NEEDS_REVIEW_THRESHOLD`, `PRICE_DRIFT_THRESHOLD`), `priceGrid.js` (`chainPriceGrids`: first non-null grid wins), `justTcg.js`, `pokeWallet.js`, `pokemonTcgApi.js`, `rapidPokemonTcg.js`, `tcgdex.js` (price clients).
- `scan/scanAndPrice.js`: identifies a front (optional back) photo and pulls multi-source comps.
- `server/multipart.js`: multipart parser for `POST /api/scan`.
- `tcgplayer/client.js`: TCGPlayer official market and mid pricing (no scraped solds).

### Other `tools/` folders

`tools/relay/` (10): Cloudflare Worker for shared learning.
- `src/index.js`: Worker entry; the hourly cron calls `flushPending`.
- `src/handler.js`: request handler; hashes the install id before storing.
- `src/validate.js`: validation of contribution schema v1 (`validateContribution`, `validateBatch`, `splitFor`).
- `src/cron.js`: hourly job that commits pending items to the `inbox` branch.
- `src/github.js`: the few GitHub Git Data API calls.
- `src/ids.js`: HMAC-SHA256 of the install id (`hashInstall`).
- `src/config.js`: reads and checks relay settings; one error names what is missing.
- `test/builders.js`, `test/fakes.js`: contribution builders and in-memory fakes for `tests/relay-*.test.js`.
- `wrangler.toml`: Worker config; deploy from this folder with `npx wrangler deploy`.

`tools/shared-data/` (53): data-repo template, nightly pipeline and signing.
- `README.md`: overview and setup. `pins.json`: pinned model and catalog assets and thresholds. `.github/workflows/nightly.yml`: the nightly workflow. `requirements.txt`, `requirements-sign.txt`: pinned Python requirements.
- `pipeline/` (19 files): `augment.py` (synthetic photo-like variants), `catalog.py` (loads the extension catalog), `consensus.py` (which labels become pack rows), `contributions.py` (loads, validates and de-duplicates contributions), `embed.py` (embeds a crop like the extension), `exam.py` (EXAM scoring), `gate.py` (candidate must beat the live bundle), `manifest.py` (the manifest the extension fetches first), `new_sets.py` (embeds cards the catalog lacks into `catalogExtra.bin`), `pack.py` (community pack byte format), `prices.py` (writes the nightly `prices.json`), `regression.py` (regression set), `run.py` (the nightly pipeline), `seed.py` (seed pairs for the adapter), `signing.py` (ECDSA P-256 signing), `status.py` (writes `STATUS.md`), `train_adapter.py`, `train_check.py` (trains `check.bin`), `__init__.py`.
- `scripts/` (5): `build_regression.py`, `build_seed.py`, `fetch_assets.py` (downloads pinned assets, checks sha256), `keygen.py`, `sign_release.py` (signs `manifest.json`).
- `tests/` (23): 20 `test_*.py` unittest modules (for example `test_pack.py`, `test_gate.py`, `test_workflow.py`) plus `_paths.py`, `helpers.py`, `fixtures/pack-v1.bin`.

`tools/vellum-ai/` (178): Python identify and detect sidecars. `models/` (76 tracked files) is off-limits.
- Servers: `identify_server.py` (port 8787: CLIP, FAISS, detector), `server.py` (port 7331: `POST /detect`, `GET /health`).
- Other top-level files: `README.md` (setup), `requirements.txt`, `Dockerfile` (build from the repo root), `pokemon-ai.spec` (PyInstaller spec), `start_server.bat`, `start_server.sh`, `pricing.py` (pokemontcg.io lookup, 24-hour disk cache), `calibrate_accept.py`, `eval_queue_cards.py`, `scan_lots.py`, `smoke_test.py`.
- `vellum_ai/` (23): the library: `pipeline.py` (end-to-end identify), `detect.py`, `detect_multi.py`, `identify_multi.py`, `retrieve.py` (CLIP and FAISS), `fusion.py` (RRF fusion and accept or abstain gates), `local_verify.py`, `name_candidates.py`, `ocr_names.py`, `ocr.py`, `rectify.py`, `phash.py`, `dhash.py`, `set_symbol.py`, `slab_label.py` (grading slab labels), `tcg_lookup.py`, `collectr_resolve.py`, `variant_labels.py`, `variant_photos.py`, `variant_train.py`, `verify_grid.py`, `eval_score.py`, `__init__.py`.
- `catalog/` (7): `build_catalog.py`, `download_images.py`, `embed_all.py` (OpenCLIP embeddings and FAISS index), `build_phash.py`, `backfill_coverage.py`, `set_years.py`, `refresh_weekly.py`.
- `detect/` (21): detector training and evaluation (`train_detect.py`, `retrain.py`, `eval_*.py`, `stress_test*.py`), synthetic data (`synth_*.py`, `make_card_fixtures.py`, `seed_art.py`, `bootstrap.py`), labeling (`bootstrap_from_inbox.py`, `label_marketplace.py`, `review_proposals.py`), and `dataset.yaml` (YOLO dataset config, classes `full_card`, `corner_closeup`, `card_back`), `loop_stages.json` (stage gates and weights for the multi-card identity loop), `marketplace_cases.json` (Facebook Marketplace and HiBid lots used as multi-card detect fixtures).
- `scripts/` (2): `harvest_variants.py`, `peek_search.py`. `tests/` (31): `test_*.py` unittest modules. `windows/` (2): PowerShell scripts that register and remove the weekly catalog refresh task. `hf-space/` (3): `Dockerfile`, `README.md`, `populate.sh` for a Hugging Face Space.

Smaller folders:
- `tools/chrome-extension/` (9): older dev extension that talks to the sidecar on port 7331: `manifest.json`, `background.js` (relays overlay events, opens the popup as a tab), `content.js`, `popup.html`, `popup.js`, `create_icons.py`, `icons/`.
- `tools/extension-wasm-sealed/net.js`: replaces `lib/net.js` in the sealed build only (`-Sealed`); also accepts the scorer's `127.0.0.1` photo server.
- `tools/labeler/` (4): `index.html`, `labeler.css`, `labeler.js` (modes `box`, `review`, `drawn`), `box-geometry.js` (box geometry helpers, tested by `tests/labeler-box-geometry.test.js`).

### `scripts/` (54 files)

Top level:
- `build-wasm-extension.ps1`: builds `dist/extension-wasm`, `-Sealed` and `-Store` variants.
- `setup_vendor.ps1`: downloads onnxruntime-web into `tools/extension-wasm/vendor/`; `vendor-hashes.json` pins the file hashes.
- `run-vellum-ai.mjs`, `run-vellum-tests.mjs`: start the sidecar and run its Python tests (backing `npm run vellum-ai` and `npm run test:vellum`).
- `realworld-run.mjs`: real-world run of the dev extension build on public marketplace pages; needs an explicit pages file.
- `sealed-score.mjs`, `sealed-import.mjs`, `sealed-label.mjs`: scoring, import and hand labeling for the sealed test set; run only when the user asks (see the rules above).
- `references-dev-check.mjs`: leave-one-out check of reference memory on own corrections; prints counts only.
- `scan-pricing-smoke.mjs`: live pricing smoke for the scanner path. `price-eval-ids.mjs`: prices exactly identified cards from an eval report through the JustTCG client. `loop-debug-report.mjs`: one-shot health report for loop ticks.
- `fetch-goodwill-lot.mjs`, `harvest-hibid-photos.mjs`: save listing photos for detector labeling and checks.
- `gen-set-totals.mjs`: writes `lib/set-totals.js`. `render-icons.mjs`: renders store icons and the promo tile from `docs/store/*.svg`.
- `build-hub-penalty.py`: builds the optional look-alike list `tools/extension-wasm/data/hub-penalty.bin` (generated, not tracked). `embed-card-back.py`: rebuilds `CARD_BACK` in `lib/card-back.js`. `convert_catalog_for_browser.py`: converts catalog embeddings to `catalog.bin.gz`. `export_clip_onnx.py`: exports the CLIP visual encoder to ONNX (fp32, then int8).
- `bench-round5.mjs` to `bench-round11.mjs` (7 files) and `investigate-abstains.mjs`: older benchmark scripts that post saved crops to the local server (purpose not stated in the files).

`scripts/lib/` (12):
- `store-package.mjs`: the store transform (`STORE_NAME`, `STORE_HOSTS`, `STRIP_FILES`, `stripDevBlocks`).
- `dhash.mjs`: difference hash with a decompression-bomb guard. `profile-cache.mjs`: guards against Chrome running a cached service worker from an earlier launch of the same profile.
- `references-loo.mjs`: corrections from an export that carry an embedding. `references-sealed.mjs`: hashes of sealed photos and crops (only hashes leave the function).
- `sealed-import.mjs`, `sealed-label-server.mjs`, `sealed-labels.mjs`, `sealed-metrics.mjs`, `sealed-paths.mjs`: helpers for the sealed scripts (import, a local labeling server, row validation, box matching metrics, folder containment and loopback checks).
- `training-hashes.mjs`: hashes of pictures the scanner trained or tuned on. `training-match.mjs`: marks a listing "in training" by its marketplace id.

`scripts/archive/` (13): a README and 12 one-off diagnostic and Playwright scripts from October 2026, kept for history; not run by the test suite.

### `tests/` (185 files)

- Naming: `tests/<name>.test.js` by convention covers the module with the same base name (`fusion.test.js` for `lib/fusion.js`, `relay-validate.test.js` for the relay's `validate.js`). It is a convention, not enforced; some files cover several modules. There are 141 `*.test.js` files at the top of `tests/`, all run by `npm test`.
- `tests/e2e/`: Playwright specs (`check-live`, `demo-overlay`, `draw-box`, `extension-chrome`, `extension-overlay`, `extension-visual`, `extension-wasm-popup`, `overlay-remove`, `screen-card-detection`), `live-scan.mjs`, and `screenshots/` (PNGs; do not open). `scan-smoke.spec.js` and `public/scan-test.html` are untracked local files; `playwright.config.js` names the spec, and the spec loads the page.
- `tests/fixtures/` (6): check-model and corner parity files, Facebook photo sizes, a trimmed price snapshot. `tests/helpers/` (2): `fake-idb.js`, `fake-page.js`.
- Contract pins (each fails when a shared contract drifts): `store-build.test.js` (exact store permissions and hosts), `store-clean.test.js` (package cleanliness), `store-transform.test.js` (`stripDevBlocks`), `sealed-build.test.js` (sealed build differs from shipped only in the source-URL check; Windows only), `extension-wasm-build.test.js`, `share-rows.test.js`, `share-queue.test.js`, `shared-data-pack.test.js` (extension reads the Python pack format), `contribution.test.js`, `fusion.test.js`, `confirm-rule.test.js`, `bundle.test.js`, `packaged-check.test.js`, `relay-handler.test.js`, `relay-validate.test.js`, `relay-cron.test.js`, `box-signal-wiring.test.js`, `hidden-cards-wiring.test.js`.

### `docs/` (44 files)

- Current: `handoff-fable-5.2-hardening.md` (hardening handoff), `known-limits.md`, `blurry-training-plan.md`, `blurry-training-review.md`, `improvement-plan.md`, `publish-v3.0.md`, `release-v3.0-notes.md`, `team-goals.md`.
- `plans/`: `shared-learning.md` (schema and relay design), `launch.md` (store launch plan), `self-learning.md`, `card-picker-and-sealed-test.md`.
- `store/`: `listing.md`, `privacy-policy.md`, `icon.svg`, `icon-small.svg`, `promo-small-440x280.png`.
- `archive/` (8): old handoffs and plans (`README.md` says they are superseded history; it does not list them). `autopilot/` (19): Cursor notes, `queue.json`, and PRDs for two earlier projects.

### Entry points and commands

| npm script | Command |
|---|---|
| `start` | `node --env-file=.env src/index.js` |
| `test` | `node --test tests/*.test.js` |
| `test:vellum` | `node scripts/run-vellum-tests.mjs` |
| `vellum-ai` | `node scripts/run-vellum-ai.mjs` |
| `lint` | `eslint .` |

| Process | Entry | Port |
|---|---|---|
| Node dashboard and API | `src/index.js`, `src/server.js` | 3000 |
| VellumAI identify sidecar | `tools/vellum-ai/identify_server.py` | 8787 |
| Extension detect sidecar | `tools/vellum-ai/server.py` | 7331 |

| Playwright project | Selection (from `playwright.config.js`) | Mode |
|---|---|---|
| `chromium` | every spec in `tests/e2e/` except `extension-chrome`, `extension-visual`, `scan-smoke`, `draw-box`, `overlay-remove`, `check-live` | headless |
| `extension` | `extension-chrome`, `extension-visual`, `extension-wasm-popup`, `scan-smoke`, `draw-box`, `overlay-remove`, `check-live` | headed |
| `demo` | `demo-overlay.spec.js` | headed |

### Where to change what

| To change | Start in | Also check |
|---|---|---|
| Confirm and accept thresholds (`CONFIRM_ROWS`, `CONFIRM_MIN_HEIGHT`, `BELOW_HIGH_CONFIDENCE`, `CLEAR_GAP`, `HIGH_TIER_SIM`, `HIGH_TIER_GAP`) | `tools/extension-wasm/lib/fusion.js` | `tests/fusion.test.js`, `tests/confirm-rule.test.js`; refit on labeled non-sealed data |
| Model files, versions, sha256 pins, cache name | `tools/extension-wasm/lib/setup.js` (`ASSETS`, `OPTIONAL_ASSETS`, `CACHE_NAME`) | `tests/extension-setup.test.js`, `tests/model-cache.test.js` |
| Contribution schema v1 | `tools/extension-wasm/lib/contribution.js` | the same schema in `tools/relay/src/validate.js` and `tools/shared-data/pipeline/contributions.py`; `docs/plans/shared-learning.md`; `tests/contribution.test.js`, `tests/relay-validate.test.js` |
| Store package transform (name, hosts, stripped files) | `scripts/lib/store-package.mjs` | `tests/store-build.test.js`, `tests/store-transform.test.js`, `tests/store-clean.test.js` |
| Developer-only code | blocks between `// dev-only:start` and `// dev-only:end` (for example in `tools/extension-wasm/popup.js`); removed by `stripDevBlocks` | `tests/store-transform.test.js` |
| Relay validation rules | `tools/relay/src/validate.js` | `tools/relay/src/config.js`, `tests/relay-validate.test.js` |
| Relay install hashing and hourly commit | `tools/relay/src/ids.js`, `tools/relay/src/cron.js` | `tests/relay-handler.test.js`, `tests/relay-cron.test.js` |
| Relay and bundle addresses used by builds | `tools/extension-wasm/lib/shared-config.js` | `tests/store-build.test.js`; changing it changes what every build talks to |
| Server pricing rules (median, minimum sources, review and drift thresholds) | `src/pricing/pricing.js` | `tests/pricing.test.js` |
| Price-grid source order | `src/index.js` (`chainPriceGrids(justTcgClient, tcgdexClient)`), `src/pricing/priceGrid.js` | `tests/priceGridFallback.test.js` |
| PokeGrade quota circuit | `src/pokegrade/circuit.js`, `src/pokegrade/client.js` | `tests/pokegrade.test.js` |
| Nightly extension price file | `tools/extension-wasm/lib/price-snapshot.js` (reader) and `tools/shared-data/pipeline/prices.py` (writer) | `tests/price-snapshot.test.js` |
| Community pack format | `tools/shared-data/pipeline/pack.py` and `parsePack` in `tools/extension-wasm/lib/bundle.js` | `tests/shared-data-pack.test.js`, `tools/shared-data/tests/test_pack.py` |
| Build variants (dev, sealed, store) | `scripts/build-wasm-extension.ps1` | `tests/extension-wasm-build.test.js`, `tests/sealed-build.test.js`; never hand-edit `dist/` |
| Playwright projects and spec selection | `playwright.config.js` | `tests/e2e/` |
