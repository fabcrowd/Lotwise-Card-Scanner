# Pokémon Card Scanner

Personal Windows toolkit that finds Pokémon TCG cards in photos, names them and shows prices.

The product is a **Chrome extension** in [`tools/extension-wasm/`](tools/extension-wasm/). It scans the photos on a web page, names each card, and overlays the set and a price. The recognition models run in the browser (CLIP and YOLO through onnxruntime-web), so nothing needs to be running on this PC.

The repo also holds the older local toolkit that came first and still works:

- **Node dashboard and API** (`src/`, `public/`): upload a photo and get identity plus a price grid per card. It binds to the LAN, so a phone on the same Wi-Fi can use it.
- **VellumAI** ([`tools/vellum-ai/`](tools/vellum-ai/README.md)): Python detect and identify sidecars (YOLO detector, CLIP/FAISS catalog retrieval, OCR).
- **Shared learning templates** (`tools/relay/`, `tools/shared-data/`): see [Shared learning](#shared-learning).

## Browser extension

Source is `tools/extension-wasm/` (manifest version 3.1.0). `dist/` is generated: rebuild after changing source and never edit it by hand. Shell is PowerShell.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup_vendor.ps1                              # once: fetch onnxruntime-web into tools/extension-wasm/vendor
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1          # dev build -> dist/extension-wasm
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1 -Store   # store package -> dist/extension-wasm-store (+ zip)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1 -Sealed  # sealed-score variant -> dist/extension-wasm-sealed
```

To load it in Chrome: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `dist/extension-wasm`. On first launch the popup asks you to click **Download models** (about 147 MB, one time); **SCAN PAGE** stays off until that finishes. Full steps are in [`tools/extension-wasm/INSTALL.md`](tools/extension-wasm/INSTALL.md).

The dev build keeps the localhost dashboard host permissions, test-photo collection and test hooks. The store build drops those, requests `<all_urls>` only as an optional permission, and its permission and host list is pinned by `tests/store-build.test.js`. When the dashboard is running, the dev build uses `GET /api/price-grid` for per-condition JustTCG pricing.

What it does today:

- Scans a page, or a whole long page, and overlays name, set and price on each card it finds.
- Lets you confirm a guess or choose the card, including the printing (set and version) when several are close.
- Lets you draw a box around a card it missed.
- Lets you remove a card with the X.
- Skips a card it cannot price instead of guessing a price.
- Copies or downloads the lot with one estimated lot value.
- Offers opt-in sharing, "Help improve recognition for everyone", which is off until you turn it on. See [`docs/store/privacy-policy.md`](docs/store/privacy-policy.md) for what is sent and [`docs/plans/shared-learning.md`](docs/plans/shared-learning.md) for the design.

The popup shows one price per card; condition chips (NM, LP, MP, HP, DMG) live in Settings. Confidence thresholds, the picker rules and the full-size photo upgrade are described in `CLAUDE.md` and `docs/plans/`. `data/sealed-test/` is off-limits for tuning.

### Shared learning

`tools/relay/` is a Cloudflare Worker template that receives opted-in contributions. `tools/shared-data/` is a nightly job template that builds the signed bundle the extension downloads. Both are templates the owner deploys. The data repo is `fabcrowd/card-scanner-data`. Setup steps are in [`tools/shared-data/README.md`](tools/shared-data/README.md). Never commit secrets or keys.

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
| `JUSTTCG_API_KEY` | [JustTCG](https://justtcg.com/docs/quickstart) — NM comps and the `/api/price-grid` response |
| `POKEWALLET_API_KEY` | [PokéWallet](https://www.pokewallet.io/api-docs) — TCGPlayer USD comps |
| `TCGPLAYER_PUBLIC_KEY` / `TCGPLAYER_PRIVATE_KEY` | TCGPlayer official pricing API |
| `RAPIDAPI_KEY` | [RapidAPI Pokémon TCG](https://rapidapi.com/tcggopro/api/pokemon-tcg-api) (tcggo) comps |
| `RAPIDAPI_EUR_USD` | EUR→USD rate for RapidAPI prices (default `1.09`) |
| `POKEMON_TCG_API_KEY` | [pokemontcg.io](https://docs.pokemontcg.io) — optional; raises the free-tier rate limit |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | eBay Marketplace Insights — median of last 5 sold items |
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

Playwright and the real-world harness (`node scripts/realworld-run.mjs <pages.json>`, always with an explicit pages file) load `dist/`, so rebuild the extension first.

## Layout

Top-level folders. The detailed file map is in the "Where things live" section of [`CLAUDE.md`](CLAUDE.md).

```text
tools/extension-wasm/    # the Chrome extension: manifest, background.js, popup, lib/ (detection, matching, pricing, sharing)
tools/extension-wasm-sealed/  # source for the sealed-score variant
tools/vellum-ai/         # Python detect + identify sidecars, catalog, models, tests
tools/relay/             # shared-learning Cloudflare Worker template
tools/shared-data/       # shared-learning nightly pipeline template (build, sign, pack)
tools/chrome-extension/  # older dev extension that talks to the sidecar on port 7331
tools/labeler/           # labeling tool
src/                     # Node server: identify/, scan/, pricing/, photos/, pokegrade/, tcgplayer/, ebay/, collectr/, server/
public/                  # static dashboard + Scanner panel
scripts/                 # extension build, setup_vendor, real-world and sealed-score runners, benchmarks
tests/                   # node --test suites; tests/e2e/ = Playwright
docs/                    # handoffs, plans/, store/ (listing, privacy policy), known-limits.md
tasks/                   # todo.md and lessons.md
data/                    # runtime state + card catalog (gitignored)
dist/                    # generated extension builds (gitignored)
```

## Where to read more

- [`HANDOFF.md`](HANDOFF.md): current state at the top.
- [`docs/handoff-fable-5.2-hardening.md`](docs/handoff-fable-5.2-hardening.md): the current hardening handoff.
- [`tasks/lessons.md`](tasks/lessons.md): corrections and non-obvious decisions.
- [`docs/store/`](docs/store/): store listing and privacy policy.
- [`docs/known-limits.md`](docs/known-limits.md): what the extension cannot do yet.
- [`CHANGELOG.md`](CHANGELOG.md): notable changes.

## License

Private / personal use.
