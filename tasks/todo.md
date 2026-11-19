# Facebook accuracy and UI pass (2026-10-19 → 21, feat/fb-accuracy-ui)

- [x] Step 1: a sure name with an open printing shows as identified; names from 200 px (899ba40)
- [x] Step 4: drop edge-cut boxes (e48c421)
- [x] Step 2: gallery scan + cross-photo dedupe (b032a2b)
- [x] Step 3: site-access offer (4eeb10f)
- [x] Step 5: overlay tags by verdict; popup follows rescans (49600f0)
- [x] Fix 3: adapter wait on first scans (226ba94)
- [x] Fix 1: Facebook `ctp=` original (2dc8aec)
- [x] Fix 2: title-line second opinion (e554499)
- [x] UI: bigger tags (9377d62); one search link per row (e06cc24)
- [x] Guess-first, lot totals, full-size offer (ba59d38); guesses over $50 kept out of the total (5a02883)
- [x] Training plan doc (4c4aae5)
- [x] Rejected, not committed: step 1b title guard, crop-shift re-rank, Real-ESRGAN / bicubic upscaling, blurry catalog copies, blur adapter bm0.5 (numbers in HANDOFF)
- [ ] Owner: review and merge the PR for `feat/fb-accuracy-ui` (not merged)
- [ ] Owner: re-test live in real Chrome on the two FB listings: site-access prompt, gallery, full-size bar
- [ ] Score the 12 sure cards the full-size tab produced on fbo-photo-1
- [ ] Blurry training per `docs/blurry-training-plan.md`; the gate must include FB-style sure-wrong
- [ ] The eval pack (`/workspace/fb-eval-pack.zip` on the Linux box) stays out of the public repo; copy it to the PC by hand

# Overlay / extension UI smoke (2026-10-19)

- [x] QA auditor: Chromium click-through of popup, settings, overlay; report in `tasks/qa-smoke-report.md`
- [x] QA-1: overlay labels clamped to the card; price-only under 140 px (`content.js`; Chromium `overlay-wide-fixed.png` / `overlay-narrow-fixed.png`)
- [x] PM re-verify QA-1 in Chromium (labels only; live scan still untested)
- [ ] QA-2 deferred: price-snapshot 404 `console.error` on popup open until the data-repo nightly publishes `prices.json`
- [ ] Do not commit Playwright profiles under `tasks/qa-smoke/*-profile-*`

# Daily prices from the data repo (2026-10-18)

- [x] Nightly writes `prices.json` and the sign job publishes it on the `prices` pre-release (not `latest`)
- [x] The extension downloads that one file once a day and overlays TCGdex markets by TCGPlayer product id
- [ ] The live nightly is the copy of `tools/shared-data` on `fabcrowd/card-scanner-data`. Until that copy includes this job, scans still show TCGdex's date

# Extension accuracy pass on grid pages (2026-10-18, fix/extension-only)

- [x] Dedupe rows by page element across layout shifts (a1a93e6); read each grid tile once (bf83b31)
- [x] Always show a best guess + pick-list on grid tiles (2ffb802)
- [x] Soft multi-set page prior (da083e2)
- [x] Re-read unsure grid tiles from the page's own picture, capped, degrades on failure (7f99f35)
- [x] Multi-crop averaging tried and reverted (more confident wrong names, no more right names); see HANDOFF.md
- [x] 108-vs-102 row count discrepancy: caused by ad-shifted layouts counting a tile twice (a1a93e6)
- [ ] Owner's PC: `npm test` and lint on Windows incl. the Windows-only `tests/store-build.test.js`; real Chrome Pokellector run vs the old 97-98 figure
- [ ] Store build: check the optional `<all_urls>` prompt covers source-picture refinement; update privacy text if needed
- [ ] Test refinement on other grid sites
- [ ] `hub-penalty.bin` missing from this checkout; confirm the store build ships it
- [ ] Adapter retraining with small-tile augmentation and a tiles regression slice in the nightly gate (`card-scanner-data`)
- [ ] GPU work: backbone bake-off, fine-tune, detector retrain (docs/improvement-plan.md Phase 8)
- [ ] Self-improvement loop: 1 contributor, 0 promoted rows, 46-byte community pack; needs real contributors (opt-in off, store listing not submitted)

# Store-build debug (2026-10-18)

- [x] Page set hint: set in heading/breadcrumb/title is the best guess for open rows (1536670)
- [x] Overlay labels clamped to card width; price-only under 140 px (restored 2026-10-19 after QA-1)
- [x] Era-restricted search; store build no longer requests variant.onnx
- [x] Site access and toolbar click tested on the unmodified store build via CDP `Extensions.triggerAction` (`--enable-unsafe-extension-debugging`) and Windows UI Automation on the permission dialog (`.tmp/debug-store/plib.mjs`, `p8.mjs`, `accept.ps1`)

- [x] Whole-page scan (d4f8c12): up to 12 screens / 200 cards, dedupe, scroll restored
- [ ] Whole-page scans of big sets take ~3 min for 200 cards and need the popup open throughout: speed up per-card recognition or run the scan without the popup
- [x] Back-to-back whole-page scans found 108 then 102 on Pokellector Base Set: ad-shifted layouts counted a tile twice (a1a93e6)

# Fix corner-as-front photo selection (2026-08-11)

## Plan
- [x] Restore mtime on download; sort flat inbox by IMG_####
- [x] Identify fronts/backs by content; next full-card = back; match closeups by similarity
- [x] Set front reprocesses identity; UI shows extras
- [x] Tests + README
- [x] Inbox front picker (Browse inbox photos)
- [x] Retrain Vellum detector multi-class (full_card / corner_closeup / card_back)

## Review
- Detector classes teach corner≠front; `usable_as_front` requires full_card @ conf≥0.35
- Bootstrap from inbox + 45% synth corners; corner→full rate 0% on val
- Hand-label hard failures in `data/vellum-detect/` for the next retrain

# Multi-card detection improvement (2026-09-06)

## Scope
Make contour multi-card detection reliable enough to split a table photo of 2–6 cards into individual rectified crops.

**Will change:** `tools/vellum-ai/vellum_ai/detect_multi.py`, `tools/vellum-ai/tests/test_detect_multi.py`, `src/photos/splitMultiCard.js` + JS tests if splitter behavior must change.

**Will not:** retrain YOLO, rewrite single-card `detect.py`/`rectify.py` except calling existing `rectify_card` with kept quads.

## Known failures (Claude left these mid-fix)
- [x] Grid tests fail: 5% max-area cap rejects cards that are 9–13% of a tight-grid canvas
- [x] 30°/45° tilt: `_score_quad_multi` used AABB aspect (square at 45°) — minAreaRect patch is in file, unproven
- [x] Contour finds quads then discards them; crops use AABB via `rectify_from_box` (background + no perspective)
- [x] Hardcoded warm-brown table mask (`H 5–35`) fails on other surfaces
- [x] 3-card unit test only requires 2/3; no JS tests for `splitMultiCard.js`
- [ ] Folder inbox path never calls the splitter (flat photos only) — left as-is; folders are already one-card drops

## Plan
- [x] Prove current pytest red: `python -m pytest tests/test_detect_multi.py -v` in `tools/vellum-ai`
- [x] Replace absolute 5% area cap with a scale that allows a single card in a 2–6 card frame (keep merged-blob rejection)
- [x] Keep minAreaRect aspect; keep perspective quads through to `rectify_card`
- [x] Drop or adapt the brown-table mask so it is not a hard dependency
- [x] Tighten tests: 3-card requires 3; grids and 15/30/45° stay required
- [x] Add JS unit tests for splitter (2+ crops → paths; 0/1/error → original)
- [x] Re-run pytest + `node --test` for the new JS file

## Success
- All `test_detect_multi.py` tests pass
- Splitter JS tests pass
- No ONNX / YOLO retrain
- Surgical diffs only

## Review
- `_MAX_AREA_FRAC` 0.05 → 0.35. Grid cards (~9–13%) kept; near-full-frame blobs still rejected. Merged pairs still die on aspect + landscape AABB (`W/H > 1.15`)
- Contour hits keep `quad`; crops use `rectify_card`. ONNX still AABB
- Removed brown `non_table` edge map
- Evidence: pytest 22/22; `tests/split-multi-card.test.js` 4/4
- Not done: folder inbox still does not split (intentional — one folder = one card). No live table-photo eval this pass

# Multi-card identity loop (2026-09-06)

Sequential / safe. Runbook: `.claude/plans/multi-card-identity-loop.md`

**Will change:** `tools/vellum-ai/vellum_ai/eval_score.py`, `tests/test_eval_score.py`, `tests/test_detect_identity.py`, `detect_multi.py` only if a new stage fails, `loop_stages.json`, plan notes.

**Will not:** YOLO, commits, catalog download.

## Plan
- [x] Confirm baseline: `test_detect_multi.py` 22/22; `ECC_HOOK_PROFILE` not disabled
- [x] Identity-weighted scorer (70% ID / 20% IoU / 10% count); wrong ID cannot pass on boxes
- [x] Stages 1–2: 2-card and 3-card verified IDs after detect+crop
- [ ] Stage 3: 2×2 grid IDs
- [ ] Stage 4: 3×2 grid IDs
- [ ] Stage 5: 30° tilt ID
- [ ] Stage 6: live queue/catalog or skip

## Stop
6 ticks, or stage 6 done, or two stalled ticks.

# Photo ID port — qtran pHash + spatial OCR + Didier grid (2026-09-06)

Plan reference: `.cursor/plans/photo_id_port_fdc3c1a5.plan.md` (not present in this checkout; do not rely on it). Full handoff: [`HANDOFF.md`](../HANDOFF.md).

## Plan
- [x] Phase 1: pHash rerank + catalog helper + tests
- [x] Phase 2: HP-anchor name OCR + tests
- [x] Phase 3: verify_grid + identify_multi imageUrl/grid + cycle `officialArtUrl` + worklist dual thumb + unit tests
- [ ] Browser-verify dual thumb on live dashboard (inject mock worklist row; server may already be on :3000)

## Review
- CLIP crop untouched; no commit
- pHash sidecar generation was subsequently completed: `HANDOFF.md` records 21,669 entries in `data/card-catalog/phash.json`. Revalidate that artifact before relying on it in a new environment.
- Tests: pytest phash/ocr_names/verify_grid/identify_multi green; node official-art + ui-markup + cycle green
- Harden pass: local `pokemontcg_hires_url` (no resolve_card for art), clear TCG `identity is None` fallback, grid failures swallowed, dual-thumb DOM-verified
- Full notes: [`HANDOFF.md`](../HANDOFF.md)

# UI Scanner — ID + PRICE (2026-09-06)

## Plan
- [x] `scanAndPrice` shared core + `processCard` reuse
- [x] `POST /api/scan` + Scanner panel UI
- [x] Unit/integration tests
- [x] Live JustTCG pricing smoke (`scripts/scan-pricing-smoke.mjs`)

## Review
- Pricing pulls: JustTCG live $504.11 on Base Charizard #4
- Photo identify via UI needs `PGAI_KEY` set; without it scan returns config error (endpoint still works)
- Does not auto-list; no commit

# Optionals — backfill + phash + Vellum-first scanner (2026-09-06)

## Plan
- [x] Retry failed catalog art (`backfill_coverage.py`) — 401 recovered, 1478 still missing
- [x] Build `phash.json` — 21,669 entries
- [x] Enable Vellum in `.env`; `SCANNER_IDENTITY_MODE=local-only`
- [x] Fix identify `/health` (`__version__`); start server on `:8787`
- [ ] Optional later: re-embed 401 new images into FAISS

Credential note: do not rotate `PGAI_KEY` unless explicitly requested. This is an instruction, not a pending task.

## Review
- Images on disk: 22,070; FAISS still 21,669 (new art not embedded yet)
- `npm run vellum-ai` prefers `.venv312`; `/health` ok + catalog loaded
- Scanner uses local-only resolver
- No commit; PG key unchanged

# Detector: real listing photos (2026-10-10)

Goal: ≥ 0.90 precision and recall on reviewed real photos (binders, single cards) with no sealed-product false positives.

## Plan
- [x] Root cause: 138 harvest frames in `data/vellum-detect/images/train` were labelled as one full-frame box → quarantined to `data/vellum-detect/_quarantine_fullframe_labels/`
- [x] Real eval set `data/detect-real-eval/` (2 binder pages, 3 single-card lots, 12 held-out sealed lots; split by lot) + `detect/eval_real.py` (TDD)
- [x] Stress copies `data/detect-real-eval-stress/` (half, quarter, jpeg30, dark, flip, rot90; labels transformed exactly)
- [x] `detect/synth_binder.py` (TDD): binder pages, flat-lays, single large cards, glare, tilt, 90° rotation, thumbnails
- [x] Reviewed sealed-product negatives from train lots via `label_marketplace.py` → `retrain._ingest_frames_to_dataset` (+ rot90 copies)
- [x] `retrain.py` real-photo gate (F1 ≥ 0.90 and ≥ current model)
- [x] Fine-tune → promote only if real + stress gates pass (v4 epoch 6: real P 0.91 / R 1.00, stress P 0.92 / R 1.00 at conf 0.25)
- [ ] Publish the promoted `card_detect.onnx` to the extension's GitHub release (owner action — outward-facing)
- [ ] Human audit of Claude-reviewed labels (`review_note` in each sidecar)

## Review
- Old model on real photos: P 0.17 / R 0.14. New: P 0.91 / R 1.00 (conf 0.25); P 0.96–1.00 / R 0.99–1.00 at the val-optimal conf 0.55
- Intermediate runs: v2 e2 failed rot90 / thumbnails → added to synth; v3 lost single large cards and boxed edge slivers → added single-card mode and `_MIN_VISIBLE` 0.6
- Tests: test_eval_real 6, test_synth_binder 4, retrain gate 1 — green. Full VellumAI suite: same 11 pre-existing identify-fixture failures as before

# HiBid multi-card lots: find + price ≥ 95% (2026-10-10 → 11)

Goal (user): on multiple HiBid multi-card lots, find the correct card and price it above 95%.
Metrics: *find* = detected (IoU ≥ 0.5) and exact catalog id; *price* = find and JustTCG returned that same product (set + number); `null` ids count for detection only; out-of-catalog cards count as failures.

## Plan
- [x] End-to-end scorer `detect/eval_lots.py` (TDD)
- [x] SIFT/RANSAC verification of CLIP candidates (`vellum_ai/local_verify.py`), Pocket ids filtered, second pass over CLIP ranks 21-40
- [x] Slab labels (`vellum_ai/slab_label.py`): parse PSA text, set years (`catalog/set_years.py`), promo-year exemption, `-HOLO`/`-REV.FOIL` suffixes, set-name variety line; label boxes dropped from results
- [x] Name-OCR candidate path (`vellum_ai/name_candidates.py`) when CLIP candidates fail verification
- [x] Same-art reprints split by OCR'd collector number (`verify-ocr-number`)
- [x] Detector letterbox in the shipped Python path (HiBid F1 0.953 → 0.962)
- [x] `.png` catalog art loaded by verification; pokemontcg.io set-id mapping recovered 368 more cards' art
- [x] JustTCG pricing: strict name+number+set match, set-id-filtered search (`src/pricing/justTcg.js`); `scripts/price-eval-ids.mjs` caches prices per id (100 calls/day quota)
- [x] Blind test set: first photo of 31 test-split lots, 80 boxes / 65 identifiable ids labelled from the cards themselves
- [x] Re-embed CLIP index with backfilled art (22,485 cards)
- [x] Upright crop for tilted cards inside a box (`detect_multi._upright_crop`; `_score_quad` uses minAreaRect)
- [x] Set context: dominant set (>= 2 cards) on a photo re-verifies abstained cards against that set, and flips same-art reprints from another set to the page's set unless the number was OCR-confirmed
- [x] JustTCG set aliases (`justTcgSetName`: Black Star Promos, SM Base Set, Radiant Collection); `normalizeSetName` strips only short code prefixes
- [x] Detector v5 (`models/card_detect_v5`, last.pt): HiBid test R 0.85 -> 0.975 at conf 0.55, but stress negatives get more FPs (14 vs 5). NOT promoted: fails the stress gate. v6 (augmented negatives) rejected: recall dropped, FPs stayed
- [x] Fresh blind set `test2`: 18 lots harvested after all tuning, 130 boxes / 84 determinable ids (`decisions_test2.tsv`); `_is_train_lot` now excludes every named split other than train
- [x] Price test2: JustTCG quota exhausted, so added keyless TCGdex pricing by exact catalog id (TCGplayer USD, else Cardmarket EUR × ECB rate) + pokemontcg.io catalog-id lookup; `/api/price-grid` falls back to TCGdex
- [ ] Remaining: Crystal Guardians stamp reverse holo (Dual Ball), Generations vs BREAKthrough Gengar reprint, washed-out V binder (Regigigas V), Japanese slabs (not in catalog)

## Review
- Dev (18 photos, tuned on): find 0.981, price 0.981 — not a valid accuracy claim
- Blind test v1: find 0.462 → v2 (name path, labels, reprints, letterbox): 0.631 → v3 (upright crop): 0.723. Misses were inspected and fixed against, so this set is now partly tuned on
- **Fresh blind test2 (never tuned on): find 0.964 (81/84)** with the shipped v4 detector and with v5; detect recall 0.969 (v4) / 1.000 (v5)
- **test2 price 0.964 (81/84)** via TCGdex: every correctly found card priced as that exact product. TCGdex vs JustTCG on 57 shared ids: median diff 0%, 52/57 within 15% (outliers = 1st Edition vs Unlimited)

# Deep debugging session (2026-10-12)

## Fixed (tests first; Node 294/294, Python 219 OK)
- [x] `decidePrice` counted string / NaN / 0 comps ('12.50' + 12 gave a $606 auto price). Only finite positive numbers count now.
- [x] `/detect` showed the whole-dollar Mercari list price as `market_price` ($0.46 card showed $0.00). It now uses the unrounded median `market` from `decidePrice` / `scanAndPrice`.
- [x] `/detect` never removed `data/detect-tmp/<uuid>` (264 dirs, ~60 MB). Removed in a `finally` now. The old dirs are still on disk.
- [x] Cardmarket-EUR TCGdex comp was medianed with eBay / Collectr / PokeGrade / PokéWallet USD comps. All US comps now exclude it.
- [x] eBay sales with a missing price were counted as $0.
- [x] Dead `isUnclassifiedDetection` removed; CLAUDE.md now describes the real single-card path. `extension-overlay.spec.js` defines `originalFetch`.

## Open (confirmed by reproduction, not fixed)
Server
- [x] Multi-printing cards go `auto` at the preferred printing. `compsForOnePrinting` now treats any source with more than one priced variant as ambiguous until a printing is chosen.
- [x] Pricing fetches time out (TCGdex, JustTCG, pokemontcg.io, ECB rate).
- [x] TCGdex tries the unpadded and zero-padded id. pokemontcg.io search sends the collector number and escapes quotes.
- [x] JustTCG refuses a name-only match; `/api/price-grid` returns 400 without a set or number. The grid keeps English and the first price per condition.
- [x] Sub-$0.50 cards whose list price rounds to $0 go to needs review. Low PokeGrade confidence still forces review after the printing filter.
Python (tools/vellum-ai)
- [x] Tilted cards are warped from the already-ordered quad. Steep-tilt tests pass (25° through 75°).
- [x] A clearly read slab name is not replaced by another card at the misread number (Venusaur #16 no longer becomes Zapdos). A garbled name still resolves by set + number.
- [x] SIFT feature cache is 512 entries and does not cache missing images.
- [x] `TG06/TG30`, `SV001/SV122`, and `SWSH020` parse, and those tokens are not set codes.
- [x] `identify_lot` dedupes by catalog id. Copies in one photo stay; a second photo keeps the sharper shot.
- [x] A name with no OCR number is no longer cut at 80 prints.
Extension (tools/extension-wasm)
- [x] `printingByNumber` uses TCGdex official set totals (`lib/set-totals.js`), so 001/165 stays 151 instead of Mega Evolution. Prefixed subsets (H01/H32) use their own count.
- [x] Number parser reads each token, so "SVI EN 001/198" parses and "EN001/165" does not.
- [x] `loadPhotoSource` checks each redirect itself and blocks private hosts (`*.localhost`, IPv4-mapped, 100.64/10). Rebuilt into `dist/extension-wasm`. Reload the unpacked extension to pick it up.
- [x] A scan aborts if the tab is no longer active, and the overlay is sent to the tab that was scanned.
- [x] The photo-scan confidence floor is restored to the previous value, not left at 0.25.
- [ ] Offscreen boxes counted and pinned to the top; lazy-load auto-rescan ignores era and overwrites the enriched overlay.
- [x] The lot total follows the enabled condition. A missing condition is not filled with the NM price. Empty graded cells are skipped.
- [ ] Price cache in extension storage still has no eviction.

# Chrome Web Store launch and listing-photo focus (2026-10-16)

Plan: `docs/plans/launch.md`. Nothing is pushed (branch `feat/card-picker-sealed-test`, 22 commits ahead of `main`).

## Done
- [x] Store package: minimal permissions, optional site access, pinned downloads, store vs dev build (ef11ec4)
- [x] Privacy policy, listing copy, original icon (5d4d99c)
- [x] Scan the listing's own photo, not carousels; related-section headings; largest rendition of the photo (6830ccb, 7278b5f, 2c8678b)
- [x] Crop card art the way the catalog was embedded (34bc430)
- [x] Picker ordered by listing title; repeat-name guard; optional look-alike penalty, off (be75912, f1366ba)
- [x] Name and price when only the set is open; "high" earned honestly (a56c0e9)
- [x] Offer full-size photo access after a screenshot-only scan (25adc7e)
- [x] Lookalike versions (ex / V / VSTAR / Dark) with price ranges (ac3d08e)
- [x] Fixes from fresh-context review (a1606f2)
- [x] Shared learning: relay, data-repo template, signed community pack (508e616)
- [x] Security fixes for shared learning (87f2d0e, 58a9c93)
- [x] Real-world runs on 28 dev pages and 30 held-out pages (results in HANDOFF.md)

## Open
- [ ] Sealed test set has no labels yet; collect exam photos from real use
- [ ] Owner: manual store-zip test, contact email, privacy-policy hosting, Chrome Web Store developer account, name and icon approval, push and publish, deploy the relay and data repo (`tools/shared-data/README.md`)

# Self-learning (next) — plan: `docs/plans/self-learning.md`

- [x] 1. Security fixes (87f2d0e, 58a9c93)
- [x] 2. Signed bundle replaces the pack-only manifest (catalog, memory, adapter, check; per-part sha256; hot-load) (1f42193)
- [x] 3. Seed data, the three add-ons (memory, photo adapter, "is this a card?" check), one gate, nightly `STATUS.md` (1f42193, 03db8eb)
- [x] 4. New sets added automatically (1f42193)
- [x] Report a measured gain on the HiBid regression set before anything ships (03db8eb: accepted-right 43 -> 85, accepted-wrong 42 -> 32 on 203 rows)
- [x] Deploy relay and data repo; point the extension at them (c583710)

# Lot value and set confirmation on lots (2026-10-17)

## Done
- [x] Lot value estimate; ask about every unrecognised card (ab122cc)
- [x] Corner number read from the source photo for open-set cards
- [x] Best guess for open-set rows: page prior, then picture score; "?" confirms; Set? menu and confirm save corrections
- [x] Measured before/after on 67 HiBid lot photos and 48 synthetic pages (numbers in CHANGELOG.md 2026-10-17)

## Review
- Corner reads rescue few real lot cards: on HiBid none under 400 source px settled its set, and each try cost about a second (median scan 3.4 s -> 4.4 s, p90 8.3 s -> 15.5 s at a 120 px gate). At a 400 px gate the results are identical and the median is 3.8 s (total 310 s -> 401 s). Most of what remains is about 1.2 s per open card of 400 px or more.
- Picture-only guesses are right about half the time on HiBid (74% on synthetic pages). Shown anyway by the owner's rule: always best-guess; corrections train.
- The page prior also applies across grid tiles of a search page, which are separate listings. Not measured.

## Open
- [x] Popup simplification
  - Review: popup shows one price per card (in the row head) and one est. value; filters come only from Settings.
  - Pills, API-key hint, ms/cards stats, condition grid and warning sentences are gone (tooltips instead). Verified: npm test, eslint, popup e2e 5 of 5.
- [~] Detection learning: shape-filter part done (boxes up to 1.82 wide/tall kept; on 67 HiBid lot photos +9 cards found, +6 right names, wrong names 13→14, no losses, 0 extra boxes on sealed-product negatives)
- [x] Detector misses ~18 heavily tilted cards: tried, not shipped (2026-10-18). Retrain of v4e6 + tilted synthetic pages (`models/card_detect_v7b`) offline found 284→302/305, F1 .977 = shipped; but in Chrome on 67 lot photos found 195→203, right names 106→107, confident wrong names 14→21. Detection is no longer the bottleneck; recognising tilted cards is


## Fresh set R150 result (2026-10-25)
- [x] Labeller B done (716 rows). Agreed set: 265 boxes from 17 listings on 5 sites; by band <100/100-149/150-199/200-299/300+ px: 0/18/143/47/57.
- [x] R150 scored once: 197 confirms, 3 wrong (shipped 71, 1 wrong). Fails criterion 2 (extra wrong-rate upper 4.9% vs <=3%) and 3a (all-confirm upper 3.9% vs <=2%). Not adopted; `CONFIRM_ROWS` unchanged. Report: `card-scanner-data/data/reports/fresh-150/README.md`.
- [x] The fresh set is spent: it is viewed and no longer blind. Do not tune on it.
- [ ] R150b (frozen R150 rule for 150-199 px only) came from looking at the result. Pre-register it in writing first, then score once on a new harvest with two blind labellers.

## Detection-recall audit result (2026-10-25)
- [x] 30 fresh photos: detector boxed 574 of 686 visible card faces, recall 83.7% (photo-clustered 95% CI 74.0-93.2%); Pokemon only 86.2% (77.2-94.9%). Grids and binders 98.6% (415/421); dense piles and bulk lots 63.1% (142/225); 83 of 112 misses are overlapping cards. 41 false boxes; about 51 boxes span two or more cards. Report: `card-scanner-data/data/reports/recall-audit/README.md`.
- [x] Upper bound only: the sample took listings where the detector already found 12+ boxes (photo 1, capped at 40), so total detector failures cannot show.
- [ ] Implication, not yet proven on the live page: for neat grid lots the drifting boxes more likely come from overlay placement (pinned to the `<img>` element box) than from the detector. Check in the dense-lot diagnosis.

## Release QA gate (must pass before anything is shown to the owner)
- [ ] Unit tests: `npm test` passes with the real exit code; `npm run lint` clean.
- [ ] Builds: dev and `-Store` build; `tests/store-build.test.js` passes.
- [ ] Live smoke in the owner's Chrome on listings we find ourselves, at least: Facebook letterboxed portrait binder page; Facebook landscape lot; Facebook graded-slab lot; Facebook single card; Mercari lot; one other site (HiBid or eBay).
- [ ] Screenshots per listing per the Smoke round 2 protocol, embedded in the report; director checks every one.
- [ ] Overlay: every box on its card within about 5% of card size, before and after scroll, window resize and photo carousel change; labels readable, no overlap.
- [ ] Every overlay check is judged on the on-screen page screenshot (canvas dumps only for measurement); the director opens the robustness shots before accepting.
- [ ] Identity and price: spot-check names on the screenshots; prices shown match the popup rows; slabs either handled or clearly marked as not handled (no raw-card price shown as a slab price).
- [ ] Popup: totals, Choose picker, skip, export, full-size offer, High value chip; no Accept all.
- [ ] Regression: each bug found gets a failing test first, then the fix, then a rerun of the whole gate.
- [ ] Report to the owner only after all boxes above are ticked, with screenshots and any known limits stated plainly.

## Stamped cards (owner request 2026-10-25)
Owner chose: all phases, set-logo stamps first. Plan and evidence: `.tmp/stamps/plan.md` (research: `.tmp/stamps/research.md`). Rules: price never decides confirmation; a stamp only preselects; no Accept all; no new host permission; never tune on `data/sealed-test`.
- [ ] Decisions first: D1 keep or downgrade set-stamp OCR auto-pricing (`background.js:1897-1907`); D2 EX set stamp = reverse suggestion (default) or sure finish; D3 keep or drop the "PLATINUM" corner word after one real photo; D4 pytest style for new `tools/shared-data` tests.
- [ ] Phase 0 (owner): copy the price job from `tools/shared-data` to `fabcrowd/card-scanner-data`; the `prices` release is 404 today, so no snapshot reaches installs.
- [ ] Phase A1: OCR the Legend Maker (ex12) and Dragon Frontiers (ex15) stamps in `lib/variant.js` `STAMP_SETS`; tests first in `tests/variant.test.js`; check the logo sits in `ART_STAMP_BOX` on 10+ non-sealed photos per set.
- [ ] Phase A2: a set stamp in ex10-ex16 preselects `reverseHolofoil` (TCGplayer prices the stamped reverse as the set's Reverse Holofoil); never `finishSure`; tests first in `tests/variant.test.js`, `tests/card-display.test.js`.
- [ ] Phase A3: price the 182 of 744 ex10-ex16 cards that TCGdex leaves unpriced, via the catalog-id section of `prices.json` (needs B).
- [ ] Phase B1: nightly `tools/shared-data/pipeline/prices.py` reads TCGCSV `/products`, maps exact name tags to stamp keys and joins to catalog ids (set + number + name, single match only); writes `cards` into `prices.json`; pytest fixtures from `.tmp/stamps/tcgcsv-samples`.
- [ ] Phase B2: `lib/price-snapshot.js` keeps `cards`, adds `snapshotCard` and the catalog-id base fallback; old snapshots still parse; `tests/store-build.test.js` unchanged.
- [ ] Phase C: popup Stamp choice (None, priced stamps, Other stamp); a user pick prices; no price shows "No stamped price found. Showing the regular card price." and stays out of the lot total; EX set logo maps to Reverse Holo; e2e checks no Accept all.
- [ ] Phase D: listing-text hint "Stamp? check" in `lib/title-prior.js`; preselect only on single-card listings, flag only in lots; negatives such as "Sealed Prerelease Deck" and "Pokemon Center Lady" tested first.
- [ ] Phase E: one picture template per stamp family and era (`lib/promo-stamp.js`), run only on 400 px+ cards whose id has that stamp; thresholds fitted on non-sealed train photos, scored once on held-out, split by listing and near-duplicate group.
- [ ] Phase F: QA gate: npm test, lint, Python tests, dev and `-Store` builds, nightly dry run under 8 MB, live smoke on stamped listings (Legend Maker, Dragon Frontiers, Crystal Guardians, Prerelease, Staff, Pokemon Center, Prize Pack, Base Set 1st Edition, a lot); then update `docs/known-limits.md`.

## Smoke round 2: screenshot protocol (queued after the dense-lot diagnosis)
- [ ] Roles: Opus director writes the run sheet, approves listings, verifies every claim against the screenshots, decides. Sonnet release/QA engineer drives Chrome and captures. A separate Sonnet UX reviewer grades the screenshots against the checklist without seeing the QA engineer's verdict. A Sonnet extension engineer acts only on a filed bug, test-first. All are experts; none commit.
- [ ] Setup record per run: extension version and build commit, Chrome window size, devicePixelRatio, page zoom, served photo size (fbcdn `stp=` value), whether the `ctp=`-dropped original was fetched (service-worker log line).
- [ ] Listings: the owner's dense slab lot (about 60 cards, the all-Check case), the Rock Island 'LOT OF 27' listing (about a dozen per photo), one single-card listing, one Mercari lot.
- [ ] Shots per listing, saved as `.tmp/smoke/<date>-<listing-id>/NN-<what>.png`: 01 listing before scan; 02 page overlay after scan at normal zoom, full photo in view; 03 zoomed crops of the densest overlay areas; 04 popup top with lot strip totals; 05 popup scrolled until every row has been captured; 06 the 'Open full-size photo' offer if shown, then 07 the overlay after using it; 08 one Choose row opened with its picker; 09 service-worker console text saved as `sw-log.txt`.
- [ ] Capture method: Playwright MCP `browser_take_screenshot` for the page. The action popup is a separate window, so capture it with a PowerShell `System.Drawing` screen grab of the popup region; do not substitute `popup.html` opened in a tab (it behaves differently).
- [ ] Checks, each pass/fail with the shot number as evidence: every box sits on one card (no box mostly on the table, none spanning two cards); every visible card has a box (count by eye vs popup 'found'); labels readable (name not cut to a few letters) and not overlapping; overlay states match popup rows; 'High value, double-check' chip on unconfirmed $50+ rows; 'small photo' chip and full-size offer appear when they should; no 'Accept all' control.
- [ ] Report: in chat, with the screenshots embedded inline and a pass/fail table; notes in `.tmp/smoke/<run>/notes.md`. Nothing under `.tmp/smoke/` is ever committed.
- [ ] Smoke results never adopt or reject R150 or change thresholds; layout bugs go to the extension engineer as failing tests first.

## Obscured-card training (paused 2026-11-08)
- [x] Tilt gate and blur arms: tilt training skipped, no blur model qualifies, model E stays. Report: `card-scanner-data/data/reports/geo/README.md`.
- [ ] Fresh test set, 600 boxes: 663 photos from 169 lots harvested (`card-scanner-data/data/harvest-20261108` and `harvest-20261108b`). Test set done: 875 agreed boxes, 133 final obscured (two blind tag passes). obscure50 degrader built, calibrated on dev, tested; pilot preregistered (`data/reports/obscure/PREREGISTRATION.md`). Pilot done (the degrader adds little beyond longer training). Recognition-gap follow-up: a corner model trained on real photos passed on a fresh blind set (+5.3 top-1; `card-scanner-data/data/reports/fresh-20261111/README.md`).
- [ ] Port the corner model behind a Chrome A/B (owner OK 2026-11-12). Started: `tools/extension-wasm/lib/corners.js`, warp in `lib/rectify.js`. Remaining steps are listed in `card-scanner-data/tasks/handoff.md` ("Owner chose 2026-11-12"). Handoff: `card-scanner-data/tasks/handoff.md`. Plan: `card-scanner-data/data/reports/obscure/PLAN.md`.

## Extension UI redesign (2026-11-14, built, not committed)
Spec: `docs/plans/extension-ui-redesign.md`. Owner asked for a consumer-ready redesign of the popup, wizard and options page. Nothing is committed until the owner asks.
- [x] Research: scanner apps and card sites (summary in the spec, section 1).
- [x] Audit of the current UI, its script hooks and test pins.
- [x] Screenshot harness `tests/e2e/ui-states.mjs` (`node tests/e2e/ui-states.mjs <label>` writes 47 PNGs to `.tmp/ui-shots/<label>/`: every popup and options state, light, dark, 420 px, 360 px, forced colors). "Before" set: `.tmp/ui-shots/before/`; final set: `.tmp/ui-shots/final/`.
- [x] Fonts, `ui/tokens.css`, `ui/popup.css`, popup markup (logo, icons, row thumbnail, price classes, one scroller, state rail).
- [x] Options page on the shared tokens (`ui/options.css`).
- [x] Accessibility pass: contrast computed for every token pair, forced-colors blocks, tab order, reduced motion, names never cut.
- [x] Live run with the real models (`.tmp/ui-shots/live/`): page boxes and popup rails agree before and after a printing pick.
- [x] Gate: `npm test` 1712 pass, 0 fail, 1 skipped; `npm run lint` clean; dev and `-Store` builds; popup Playwright spec 75 of 75; overlay-remove 3 of 3; draw-box 3 of 3.
- [x] Cold adversary review of the diff; its two should-fix items fixed (put-back focus with a new test, thumbnail name).
- [ ] Owner: look at it in Chrome (load `dist/extension-wasm`), then decide on commit. Not done by the agent: a smoke on live Facebook or Mercari listings (the `data/` profile is not in this checkout).
- [ ] Follow-ups found and left alone because they change scripts, wording or tests (owner decision): the setup wizard does not trap focus or hide the page behind it from the keyboard; four buttons have an `aria-label` that does not start with their visible text; `aria-label` on the price `div` is ignored by screen readers; the "More" button sits inside a `radiogroup`; `#stat-value` is now hidden by CSS and can be removed with its tests; the store listing's promo image and screenshots still show the old popup.

## Extension UI redesign, round 2 (2026-11-14, owner request: bigger cards, scaling, less text)
Spec: `docs/plans/extension-ui-redesign.md` section 7.
- [x] Inspiration captured: `.tmp/inspiration/` (dextcg, pkmn.gg, cardelyx, dribbble).
- [x] Slice A: layout and declutter (header icons, toast, lot card, row icon cluster, choose row, empty state), responsive panes and grid, card-size slider, tile hover motion.
- [x] Slice B: hover compare preview (`lib/loupe.js`, 19 unit tests; three Playwright tests).
- [x] Wide-window fixes: candidate grid fills the row at 1920 px; lot figure stays on one line in the side panel.
- [x] Screenshots at 500, 900, 1440 and 1920 px wide, light and dark, sizes small and large, preview open (`.tmp/ui-shots/final2/`, 66 PNGs, 0 failed).
- [x] Gate (2026-11-15): `npm test` 1731 pass, 0 fail, 1 skipped; lint clean; dev and `-Store` builds; popup spec 78 of 78; overlay-remove 3 of 3; draw-box 3 of 3.
- [x] First cold review: preview stayed open after a re-render; a saved large card size applied under 440 px. Both fixed with failing-first tests. Second review: closing the preview on every re-render made it vanish as prices arrived; fixed with `refresh()`, which keeps the preview on the tile under a resting mouse.
- [x] Third cold review: `refresh()` closed a keyboard-opened preview on each re-render (no pointer position), and the 150 ms scroll window could leave the preview beside a tile that had moved.
- [x] Fix: the preview remembers whether pointer or focus opened it and re-aims at that tile; every scroll re-aims instead of closing; the re-render Playwright test waits on a real re-render instead of a fixed sleep.
- [x] Final cold review: ship. Its polish items done: a same-card scroll only moves the preview (no image reload) and resizes the kept images; Escape, blur and focus-away pinned by unit tests; the new browser tests clean up in `finally`.
- [x] Final gate (2026-11-15): `npm test` 1740 pass, 0 fail, 1 skipped; `tests/loupe.test.js` 28 of 28; lint clean; dev and `-Store` builds; popup spec 79 of 79; overlay-remove 3 of 3; draw-box 3 of 3.
- [ ] Owner: try it in Chrome (load `dist/extension-wasm`) and decide on commit.

## Extension UI redesign, round 3 (2026-11-15, owner request: the page overlay)
Spec: `docs/plans/extension-ui-redesign.md` section 8. The owner's binder screenshot showed two-line tags covering every card's name and art.
- [x] Spec: corner brackets plus a bottom-right price chip at rest; the name card on hover, outside the card.
- [x] Build (builder, test-first) with a before/after screenshot harness `tests/e2e/overlay-states.mjs` (`.tmp/overlay-shots/before|after/`; "before" is a reconstruction, a visual reference only). Overlay unit files 82 of 82; `npm test` 1749 pass, 0 fail, 1 skipped; lint clean; overlay-remove 3, draw-box 3.
- [x] Cold review: ship. Follow-ups done test-first (overlay unit files 86 of 86, lint clean): the inside-fallback name card no longer covers the chip; 3x3 and 5x5 grid tests that no chips overlap; a test that the X wins over the name card.
- [x] Owner reference look (2026-11-15): the in-progress narrow popup, saved as `.tmp/reference/owner-favorite-2026-11-15.png`, spec 9.7.
- [x] `scan-smoke` rerun alone (2026-11-15): it still fails, and the cause predates this work. It waits for `window.updateResults` in the `dist/extension-wasm` popup (`tests/e2e/scan-smoke.spec.js:143`), but no committed `tools/extension-wasm` code ever defined that function (`git grep updateResults HEAD -- tools/extension-wasm` and the same at d175adb find nothing). The spec was written for the older dev extension's hook. Owner decision: fix the spec to drive the popup the way `extension-wasm-popup.spec.js` does, or retire it.
- [x] Popup side (spec section 9), from the owner's full-width screenshot of a priced binder page: auto-identified cards reach the popup without a page crop (`background.js` ~1282 attaches it only to unsure cards), so their rows have no picture and the compare preview has nothing beside the candidate; the wide grid overflows; names wrap to three lines; no clear end point.
- [x] Build: every card carries its crop; one row structure at every width; "Pick printing (n)" and "Priced (n)" groups and "All cards priced"; a visible "Change" that reopens the choice with Cancel; the compare dock (spec 9.5). `npm test` 1758 pass, 0 fail, 1 skipped; lint clean; both builds; popup spec 92; overlay-remove 3; draw-box 3; `node tests/e2e/ui-states.mjs round3` 82 PNGs, 0 failed.
- [x] Builder's own call, kept: cards with an open printing sit under "Pick printing (n)", never as priced rows.
- [x] Cold review of the popup diff: fix first. All five items fixed test-first. Removing or skipping a card in Change no longer leaves it stuck open. "All cards priced" counts only the shown cards and needs a real price. A same-card pick from Change is a Cancel and saves no correction. Only one row is in Change at a time. The dock image ends above the status toast.
- [x] Final gate (2026-11-15, both builds together): `npm test` 1759 pass, 0 fail, 1 skipped; lint clean; `-Store` and dev builds; popup spec 96 of 96; overlay-remove 3 of 3; draw-box 3 of 3; `node tests/e2e/ui-states.mjs round3` 82 PNGs, 0 failed; `node tests/e2e/overlay-states.mjs final` 8 PNGs.
- [ ] Owner: try it in Chrome on a real listing (reload `dist/extension-wasm`), then decide on commit.
- [x] Click a card on the page to open the scanner at it (spec 8.5), plus the high-value double-check row with Confirm (spec 9.8), the printing-tile focus and the popup sender check. `npm test` 1775 pass, 0 fail, 1 skipped; lint clean; both builds; popup spec 105; overlay-remove 3; draw-box 3.
- [x] Cold review fixes, three rounds (2026-11-15):
  - Site UI over a card keeps its clicks. The rule: the top element is site UI only when it is unrelated to the photo AND is interactive or has visible text. A transparent text-free layer, a text-free link, or a shadow-DOM photo still counts as the photo.
  - One window on a quick double-click (serialized opener, `lib/scanner-window.js`).
  - The pending card is stored only when a window is created, with its page URL, and is cleared if create fails. It is taken at popup start and applied after the restore.
  - A page click from another tab is ignored (`acceptPickSender`).
  - Focus for skipped rows. A placeholder for a failed catalog image. A bounded text probe.
  - Evidence: `npm test` 1808 pass, 0 fail; lint clean; overlay-remove 5 of 5.
- [x] Options page, spec 11.7 options part:
  - Prices / Photos / Help improve Card Scanner, then a collapsed Advanced. The look-alike switch is hidden. "Remember my fixes" and "Use my saved fixes".
  - Evidence: `tests/options-layout.test.js` 13 of 13; popup spec 106 of 106. Screenshots `.tmp/options-shots/`.
- [x] Interaction model, spec section 10, built:
  - Page pointer cursor and an X hover ring.
  - Page hover links the popup row (`overlayHover`).
  - The pill goes through the popup's full-size path.
  - Draw mode: a click without a drag stays in draw mode; Cancel button; the crosshair toggles.
  - Crop brackets brighten. A check badge on candidate tiles. `.unrec-thumb` is a button.
  - Focus preview in the review dialog.
  - Toasts with Change or Put back (8 s, hold on hover).
  - Evidence: `npm test` 1826 pass, 0 fail; popup spec 117; overlay-remove 7; draw-box 4; store tests 24 of 24.
- [x] Section 10 cold review: accept with fixes. All four fixed:
  - Toast actions check the lot and the card state. Clear, a new scan and a restore close an action toast.
  - The full-size pill: if access is granted, it runs the whole path; if not, it focuses the popup button. With the window closed, it uses a pending `{kind:"fullsize"}` record.
  - The linked ring resets on a lot change and on pagehide.
  - The text probe skips script and style.
  - Evidence: `npm test` 1832 pass, 0 fail; lint clean; store tests 27 of 27; popup spec 121; overlay-remove 7; draw-box 4.
  - The dev build holds `<all_urls>`, so the no-access pill path is shown only with a stub.
- [x] Section 11 slice A (11.1-11.3) built.
  - Built:
    - Wizard wording, plus Optional / Skip / Retry.
    - Reason line for a disabled Scan Page.
    - Status line while scanning, and a short summary toast.
    - One notice at a time.
    - "Scan again".
    - First-scan legend pill.
    - "Pick" chip, "Pick a version", "Click to pick".
  - Results: `npm test` 1851 pass, 0 fail; popup spec 127; overlay-remove 7; draw-box 4.
  - Kept: "about 147 MB", the computed figure pinned by `popup-markup.test.js`.
  - Kept: the unreadable-tab reason does not disable the button.
- [x] Slice A review fixes done: `npm test` 1859 pass, 0 fail; popup spec 130; overlay-remove 7; draw-box 4; shots `.tmp/ui-shots/slice-a2`, `.tmp/overlay-shots/slice-a2`. Fixed:
  - the status line on a rescan (`#scan-status` under the Scan button);
  - setup Retry after a thrown call;
  - a stale access notice;
  - a `scanProgress` scan guard;
  - the legend placed outside the photo (above, else below, else inside with an 8 s auto-close), with the text "Amber: pick the card".
- [x] Slice B (11.4-11.7 + summary count + options leftovers) built: one `lotCounts` feeds the lot card, headings, review button and toast; Skip this card; no-match search open; version wording; high-value chip; Copy list / Download CSV; Clear with Undo; Not read / Not a card / Left out; Add card. `npm test` 1870 pass, 0 fail; popup spec 140; overlay-remove 7; draw-box 4.
- [x] Slice B review fixes done. `npm test` 1876 pass, 0 fail (rerun by the main session); lint clean; store + options tests 37; popup spec 145; overlay-remove 7; draw-box 4; shots `.tmp/ui-shots/slice-b2`. Fixed: Undo re-requests in-flight prices; Undo refuses when the page changed; snapshot `_showNotCard` + status; list press keeps the scan summary; clear `_autoSearch` per lot; "Picked:" only for user picks; "Not read (4)" with one row; header title never wraps ("Add card" text at 560 px+); lot card "Left out".
- [ ] Known, left as is: the copy toast's "unconfirmed left out" can differ from the lot card's unconfirmed count by cards whose price is still loading.
- [x] Whole-diff cold review: accept with fixes; nothing blocks. Owner rules hold (`via` values identical to HEAD); store tests 24 of 24.
- [x] Final fixes done and reviewed (accept, nothing blocks). Evidence: `npm test` 1881 pass, 0 fail, 1 skipped (rerun by the main session); lint clean; both builds; store + options tests 37; popup spec 147; overlay-remove 7; draw-box 4; shots `.tmp/ui-shots/final/` (94), `.tmp/overlay-shots/final/`. Fixed:
  - one `resetLotUiState()` on every lot replacement path (`_whyOpen` and `_showNotCard` leaks);
  - the X always wins over `photoOnTop`;
  - `_sentHover` reset on teardown;
  - visible "printing", "variant" and "finish" changed to "version" (CSV headers kept for existing spreadsheets).
- [ ] Owner, nearby and pre-existing (not changed): the popup's `rescanResult`, `drawnCard`/`drawnFailed` and `scanProgress` listeners have no sender check (present at HEAD, `popup.js` 307/489/572). A content script on another page could send a `rescanResult` and replace the lot. Suggested fix: accept them only from the extension's background.
- [ ] Then: screenshots to the owner, handoff update; commit only when the owner asks.
  - (B) 11.4-11.7: to confirm, versions, the final screen, the header, plus the options leftovers. The fixes card says "unless you turn on shared learning above" (should name "Help improve recognition for everyone"). "0 references" should read e.g. "0 cards remembered".
- [ ] Owner question from the audit: swapping a card's version saves no correction, but picking its set does (popup.js ~1527-1529).
- [ ] Owner decisions 2026-11-15 ("behave the same"; sender check "if you think that's best"), with a builder:
  - a version swap to a definite card saves a correction like a set pick (via "candidates", an existing via); one printed in several sets saves nothing until its set is picked;
  - `saveSetCorrection` carries `drawnFields(card)`, so a drawn row's set or version pick saves its own crop (before, the set pick sent the scan's crop at that index);
  - the `rescanResult`, `drawnCard`/`drawnFailed` and `scanProgress` listeners accept only `acceptFromBackground`.
  - Then: a cold adversary review. Still open for the owner: "Tick all", the full-size pill's extra click, scan-smoke.
  - Built: popup spec 150 pass (3 new), `npm test` 1881 pass 0 fail 1 skipped, lint clean (builder report). Cold review folded into the section 12 review.
- [ ] Spec section 12 (owner, 2026-11-15): settled Priced rows collapse to one line (photo, name, set #number, value); click to expand. Also 12.5: "Tick all" removed, `scan-smoke.spec.js` and `public/scan-test.html` deleted. Built (photo = stock image with crop fallback, owner 2026-11-15): `npm test` 1888 pass 0 fail 1 skipped, popup spec 158, overlay-remove 7, store tests 10, lint clean (builder report); shots `.tmp/ui-shots/collapse/` (8), viewed by the main session. Cold review: accept with fixes. Fixed: `repeatedName` keeps a row open (12.1), whitespace in playwright.config.js and README restored, `results-printing-picked` shot opens the row. Smoke-spec deletion was the owner's ask. Not changed (matches set picks, as the owner asked): a version swap's guess is the current row and carries no price. Evidence: `npm test` 1888 pass 0 fail 1 skipped and lint clean (rerun by the main session); popup spec 159; shots `.tmp/ui-shots/final2/` (102).
- [ ] Commit only when the owner asks ("commit the UI redesign").

## Newest sets, Japanese cards, then the installer (owner request 2026-11-17)

Owner ask: add the newest sets and Japanese cards, test that recognition is accurate, then finish the Windows installer. Plan by the main session; code by builders; a cold review per slice. Commits, pushes, release uploads and the data-repo push wait for the owner to ask for each by name.

Facts found 2026-11-17 (before any change):
- The installer was finished and reviewed on 2026-11-16 (`dist/Sweep-Setup-3.1.0.exe`, `tests/installer.test.js` 10 of 10). Left: a cold review of the last fixes, and a rebuild after the extension changes.
- Newest English sets are missing for a tagging reason, not a training one. The live nightly bundle (seq 33, 2026-11-17) carries `catalogExtra` with 346 cards (me06 141, 30th 158, Pocket 47), but it is tagged model `77538aade655907f`, crop 2. The extension is model `0dba1302580da2a6`, crop 3, and `lib/bundle.js sameBuild` drops a bundle with other tags. So the shipped catalog (21,946 cards, through me05) is all the extension knows.
- Catalog rows are the v2.0 model's vectors of clean art; model E was trained against those frozen rows (`train_fast.py`). New rows must come from the same v2.0 model. The live `catalog-extra.bin` rows already do.
- Held-out result on file (`card-scanner-data/train/out/ho/`, 979 cards of the newest sets, never trained on, rows in the catalog): E-ho top-1 88.2% at 200 px and 95.7% on large crops, level with the fully trained recipe (88.8%, 96.4%). So a new set needs catalog rows, not a retrain.
- TCGdex lists 23,912 English cards and has a picture for 22,131. The catalog plus the nightly file hold 22,292. About 1,780 listed cards have no TCGdex picture (for example mep 112, 30th-c 30, sm3.5 78, sm7.5 78, swsh4.5sv 122, the trainer galleries), so the nightly job never adds them.
- Japanese: TCGdex has pictures for 3,882 of 13,156 Japanese cards (2022-2025 only). TCGplayer's Japanese category (TCGCSV category 85) has 462 sets through November 2026 with a 716x1000 picture, an English name, a number and a USD market price per card. The 2026-10-24 study (`card-scanner-data/data/reports/foreign/README.md`) found that only a vector margin against Japanese rows tells a Japanese card from an English one, and only at 150 px and above.

Plan:
- [x] A. Japanese catalog data (`card-scanner-data/scripts/build_ja_catalog.py`): list, download pictures politely, embed with the v2.0 model and with E. Long download, runs in the background.
- [x] B. Newest English sets: a nightly bundle the current extension accepts (query model and crop tags for E, rows from the v2.0 model), plus a picture fallback for cards TCGdex lists without one. Template in `tools/shared-data`; the live copy needs the owner's push.
- [x] C. Check new-set accuracy: synthetic reads of me06 and 30th cards against base plus extra rows with model E, reported next to the held-out table.
- [x] D. Japanese study, preregistered before any comparison: margin fit on labelled boxes already used for fitting, scored once on boxes not used for this question. Ship gate is English safety (false flags), then Japanese recall and candidate accuracy.
- [x] E. Extension: optional Japanese catalog asset, the margin rule, Japanese candidates in the asked flow (never confirmed without the user's pick, no price before the pick), picker search, prices by TCGplayer product id, store and privacy text, tests.
- [x] F. Installer: rebuild with the new extension, cold review, temp-folder install and uninstall run.
- [x] G. Docs: HANDOFF, README, CHANGELOG, lessons; final report with the owner-only steps named.

Progress 2026-11-17 (same request):
- [x] A (script): `card-scanner-data/scripts/build_ja_catalog.py` + `tests/test_build_ja_catalog.py` (21 pass). `list`: 462 sets, 28,023 Japanese cards, 25,602 with a picture. Picture download running (`data/ja-catalog/images.run.log`). Then `dedupe`, then `embed` twice (v2.0 model as tag `T`, model E as tag `E`).
- [x] C: new-set measurement done, preregistered (`card-scanner-data/data/reports/newsets-20261117/`). On 299 never-trained cards (me06, 30th), top-1 at 200 px is 98.7% with rows made by model E and 81.9% with the live file's v2.0-model rows; large crops 100% against 98.7%. The rule picks model E rows. Trained control cards (me05, 120) score 92.5% and 90.0% at 200 px with either kind of new row beside them (difference inside noise). Synthetic reads only.
  - Consequence: the extension must not borrow the live v2.0-tagged file. The nightly job has to run on model E (the template pins already do; the live repo does not). A plan for that switch is being drawn up; going live needs the owner's push to `card-scanner-data`.
  - Finding to raise with the owner, not acted on: rows made by model E may also read the 21,946 shipped cards better than the shipped v2.0-model rows. That is a catalog change and needs its own preregistered study on real photos plus a threshold refit.
- [ ] D: Japanese study rules written before any Japanese row existed (`card-scanner-data/data/reports/japanese-20261117/PREREGISTRATION.md`, with Amendment 1). Study script being written.
- [ ] F: installer cold review: accept with fixes (hand-typed `-InstallRoot` and `-UninstallKey` hazards, rollback message, version test, stale zip). A builder is fixing them.
- Touchpoint map for Japanese ids in the extension is done (handlers `priceCard`, `saveCorrection`, `findCards`, `candidatesFor`; export says "English"; sharing must skip `jp-` ids).

Progress 2026-11-17, second note:
- [x] B (template): `tools/shared-data` now ignores anything made with another model (live bundle, `regression.npz`, `seed.npz`, the cumulative new-card file), tags what it writes, skips digital-only sets, takes the newest sets first, and gets pictures TCGdex lacks from the static `PokemonTCG/pokemon-tcg-data` files on a number and name match. Two simulated nights in `.tmp/e-dry/` (out3, out4): night 1 adds 496 cards (me06 141, 30th 158 first), night 2 extends the same file to 721 with no repeats. The extension's own parse, merge and search code accepts that file (721 of 721 rows find themselves first). Cold review: accept with fixes; a builder is applying them.
  - Owner steps for going live: push the template to `card-scanner-data`, rebuild `regression.npz` with the current recognizer (the labelled HiBid crops behind the live file are not on this PC; without a tagged regression set nothing ships), decide on `seed.npz`, run the workflow once.
- [ ] E: Japanese support in the extension is written (separate catalog, margin rule, Japanese candidates in the question, picker search, TCGplayer prices via tcgcsv.com, export basis, options toggle, never shared). `npm test` 1990 of 1992 pass; the one failure is the placeholder hash guard for `catalog-ja.bin.gz`. Waiting for the real catalog file, the study's constants, a browser test and a cold review.
- [ ] F: installer review round 2: accept with fixes (stronger install marker, silent failures, guide-open failure). A builder is applying them. Lesson recorded in `tasks/lessons.md` (a guard test must be harmless when the guard is missing).

Progress 2026-11-17, third note:
- [x] A: Japanese catalog built. `card-scanner-data/data/ja-catalog/catalog-ja.bin.gz`: 25,531 cards, 9,046,332 bytes, sha256 `64e574fc24f844f142e6c13a0568dde4aafe7879f0608d5c313d3fb514ef774a`, rows from the v2.0 model, tagged for the current recognizer and crop 3. 2,492 listed cards have no picture and no row.
- [x] C, extended after an independent audit: the audit reproduced the synthetic numbers but showed the gain is an upper bound (rows and reads come from the same picture and model) and that rows from the current recognizer took 4 of 120 control reads. A second, real-photo condition was written into the preregistration before any number was computed (Amendment 1). Result on 3,363 labelled English boxes: rows from the current recognizer lose 3 correct reads and gain 8, with 0 added confident errors; rows from the v2.0 model lose 3 and gain 4. All three conditions pass, so the nightly keeps making rows with the current recognizer. The boxes score names, not ids.
- [x] D: Japanese study done as preregistered (`card-scanner-data/data/reports/japanese-20261117/README.md` and `ADDENDUM.md`). Frozen rule: rows from the v2.0 model, 200 px or taller, margin 0.005. Final set, scored once: 5 of 258 English boxes flagged (gate passed), 8 of 12 Japanese boxes caught (gate passed by one box). An independent audit reproduced every number from the shipped file; its cautions are in the addendum (read safety as a few percent at most, recall as roughly 40% to 90%). The extension's own code agrees with the study on 3,629 of 3,629 boxes. Blind visual check: the exact card is among the first four Japanese matches for 23 of 39 flagged boxes.
- [x] E: extension Japanese support finished: fitted constants, real hash pin, no Japanese read without an English score, a failed catalog load retried after 10 minutes, a real-file parse test and a browser test of the whole flow (`tests/e2e/japanese-cards.spec.js`, 1 passed). `npm test`: 2,000 tests, 1,999 pass, 0 fail, 1 skipped. Cold review running.
- [x] F: installer round 3 reviewed cold: no way found to delete or overwrite anything that is not Sweep's; fixes asked for (the guide must say the exe is unsigned and that Chrome warns about developer mode; a PC whose policy blocks PowerShell scripts must get a message; leftovers after failed steps must be reported). Applied (a small `launch.cmd` wrapper reports a blocked PC). Rebuilt: `dist\Sweep-Setup-3.1.0.exe`, 6,504,448 bytes; `tests/installer.test.js` 42 pass (the exe was rebuilt once more after the last fixes; its hash is in `HANDOFF.md`).

Progress 2026-11-17, final note:
- [x] B, after a cold review: the regression replay now includes the new-card rows, so a cards-only night ships only when no regression read is lost; previous-night rows and upstream data are re-checked; no silent shrink; the cards-only rule declines exactly where the signer would refuse. Template suite: 308 tests OK. Dry run night 1 (`.tmp/e-dry/out7`, stand-in regression file) still ships 500 cards.
- [x] E, after a cold review: no Japanese search under 200 px; a pick on a Japanese-flagged row is never shared and stores no picture, and an exam photo with a Japanese box sends nothing; a failed price lookup is not cached; no mid-price fallback; a status line in Settings; stricter catalog parsing. The "is this a card" check hides none of the flagged Japanese boxes (0 of 8 on the final set, 0 of 31 on the others).
- [x] G: `HANDOFF.md` ("Current state (2026-11-17)"), README, CHANGELOG, `docs/known-limits.md`, store listing and privacy policy, four lessons.
- Final gates: `npm test` 2,027 tests, 2,026 pass, 0 fail, 1 skipped; lint clean; Japanese browser spec 1 passed; `card-scanner-data` study tests 60 passed.
- [x] Go-live steps the owner asked for on 2026-11-17: commits in both repos (local, not pushed); `catalog-ja.bin.gz` published at release `v3.2` and its public download checked against the pin; the nightly template pushed to `main` of `fabcrowd/card-scanner-data` and the workflow run twice (both green, pre-releases, `improved: false`); the installer run for real on this PC.
- [x] Found by those runs and fixed: the installer's `/Q` switch ("Error creating process <None>"), and the nightly step that never downloaded the live bundle (missing `--pattern`). Both reviewed cold.
- [ ] Owner: the list under "Left for the owner" in `HANDOFF.md` (rebuild `regression.npz` from the labelled HiBid crops, which are not on this PC; installer on a clean Windows account; code signing; store form once the item exists; push the commits).

## Feature complete, self-updating, improving (owner request 2026-11-18)

Owner ask: use helpers to fix the open issues from the handoff review and make the app feature complete, self-updating and improving, rock solid and fast. Plan by the main session; code by `builder` helpers (sonnet), tests first; a cold `adversary` review per slice. No commit, push, data-repo push, relay deploy or sealed score without the owner asking for that step by name. No recognition rule, threshold or model changes without a preregistered measurement.

What "self-updating" and "improving" mean here:
- The program updates itself: a copy installed by the Windows installer learns that a newer version exists, and after the new installer has run it reloads itself (today an installed copy never hears about a new version, and needs clicks in `chrome://extensions`).
- The data updates itself: the nightly bundle (new sets, adapter, prices) keeps reaching installs. Blocked today by `regression.npz`; also at risk from a manifest that goes stale after 30 quiet days and an issue time stamped before a long build.
- The scanner improves from use: corrections reach the relay, the nightly job reads them, and the gate ships a bundle. The loop's code is fixed and live; it needs the regression set and real contributors.

Slices (one extension builder at a time, because they share `background.js`):
- [x] X1 extension, small fixes (the first two were accepted by the cold review on 2026-11-18; the third was rejected and is slice X1b below): the upload queue also drops future-dated items; `applyCatalogPrices` keeps the grid's own date when the grid has a priced printing of its own (same rule as `applySnapshot`, decided 2026-11-18 on the owner's "fix these"; the pinned test changes on purpose); a failed price lookup is retried once by itself.
- [x] X2 extension, restart and timing faults (done 2026-11-19; the "still owed" list at the end of this entry is settled. Browser runs: `overlay-remove.spec.js` 7 passed, `draw-box.spec.js` 4 passed, new `worker-restart.spec.js` 3 passed; it stops the real service worker through the DevTools protocol, and two of its three tests fail when the restore is switched off. Phone app: `npx tsc --noEmit` exit 0, `npx jest` 64 passed. Cold review: accept with fixes. Fixes applied: a stored held scan older than 30 minutes is not restored (`HELD_SCAN_MAX_AGE_MS`); the restore never overwrites state set after the worker started (`pickRestored`); the restore always settles (`settleRestore`). `node --test tests/worker-state.test.js` 12 pass. Left as is, by decision: a scan result over 2 MB is not stored, so it is gone after a restart as before; `pictureAllowed` accepts an address with a user name on an allowed host): draw mode and a held scan result survive a worker restart; the detector threshold cannot stick after two overlapping scans; the new-photos watcher sees images that load late; a cached model file is checked against its pin; the bundle parser limits picture hosts of new-card rows. State 2026-11-18, paused on the owner's "pause all tests": all six fixes are written (the look-alike margin fix from R2 is the sixth). Builder's results before the pause: 81 unit tests pass across the eight touched test files, 96 pass across the store, build and draw test files, lint clean, one rebuild, popup spec 167 passed. The pin check became a test with a committed snapshot (`tests/setup-pins.test.js`), with no run-time re-hashing. Still owed when tests resume:
  - Playwright `overlay-remove.spec.js` and `draw-box.spec.js` (the draw-box run was stopped mid-way and has no result).
  - Phone app `npx tsc --noEmit` and `npx jest` (`lib/detect.js`, `lib/search.js`, `lib/bundle.js` changed).
  - A browser test that stops the real service worker: the restart wiring in `background.js` has unit tests for its storage module only.
  - The cold review of the whole slice, then the full `npm test`.
  - Reported and left alone: three other uses of `rawHits[0]?.score` (card-back check, Japanese check, `seen.catalogTop`) have the same look-alike fault; the path is off in every shipped build.
- [x] X3 extension, self-update for installed copies (done 2026-11-19. Cold review: accept with fixes, one blocking (an open Settings page did not count as busy, so the extension could reload under the user). Fixes applied: any open page of the extension and any message or click since the worker started mean not idle; the reload waits at most 15 s for the startup upload flush and checks idle again, also after the guard write; the Restart text names the saved lots; a clock change cannot block; the guard is written through the merge helper. A second cold review of the fixes: accept, two small points, both applied. `tests/self-update.test.js` 44 pass; `self-update.spec.js` 10 passed, with cases for Settings open, a stored lot and a stored held scan. Not tested in a browser: the skip when a click lands during the guard write, and the real network path to GitHub (unit tests with a fake fetch only). Built in two parts. Part 1, self-reload: at worker start an installer copy reads its own `manifest.json` from disk; a strictly newer version reloads the extension when it is idle (scanner closed, no click since the worker started, no scan, no draw mode, nothing in session storage a reload would lose), otherwise the scanner shows a "Restart now" banner; loop guard per target version and 60 s. Part 2, release check: at most once per 24 h, or by "Check now" in Settings, it reads `lotwise-version.json` from the release tagged `installer` and shows "Lotwise <version> is available." with a button to the fixed release page. Rules in `lib/self-update.js`; state in `chrome.storage.local` key `selfUpdate`; `scripts/build-installer.ps1` writes `dist\lotwise-version.json`. Builder's results: `tests/self-update.test.js` 34 pass; store, build and installer tests 76 pass; `self-update.spec.js` 7 passed three times; popup spec 172 passed. The spec swapped the folder by rename, as the installer does, with Chromium running, and the rename worked every time. Owner steps for it to work in the field: raise the version in `manifest.json` for a release (it is still 3.1.0, the same as the installed copy), and publish a GitHub release tagged `installer` holding the exe and `lotwise-version.json`): daily version check against the project's latest release (no new host), a notice in the scanner window and Settings, self-reload when the files on disk are newer, and a version file written by `scripts/build-installer.ps1`. Inert in the store and dev builds.
- [x] X4 extension, test only (done 2026-11-19: block `box signals sent by the scanner window` in `tests/e2e/extension-wasm-popup.spec.js`, five tests covering removed, put-back, no signal for a skip, drawn with and without a scan, and a removed drawn card; each asserts the exact ordered list of `shareBoxSignal` messages. Full spec: 177 passed. No source change): a browser-level test that the scanner window sends the box signal messages (drawn, removed, put back).
- [x] N1 nightly template (done 2026-11-19; the three fixes listed at the end of this entry are applied: a key problem exits 1 in every mode; a refused re-issue exits 1 once the live manifest is 21 days old or its age cannot be read (`REISSUE_FAIL_AFTER_DAYS`); the loader catches any error and means "do not re-issue"; tests guard the loader fallback and the prices timeout, each checked by removing the line. `python -I -m unittest discover -s tests` in Git Bash: 372 tests, OK, no skips (from PowerShell three workflow tests skip with "no working bash"). `node --test tests/bundle.test.js tests/shared-data-pack.test.js`: 49 pass. Third cold review: accept, no blocker for copying to the live data repo. Copying it there is an owner-ask step): issue time stamped when the manifest is made; a quiet night re-issues the live bundle before it goes stale; one install cannot fill the exam alone; the `|| echo` fallbacks stop hiding failures; the signer limits picture hosts. Built 2026-11-18; first cold review: accept with fixes; five fixes applied (a refused re-issue no longer silences status and prices; the status download cannot lock the build; a case is skipped only when all its voters are at the cap; prices are built before the pack; README lines). `python -I -m unittest discover -s tests`: 367 tests, OK. `node --test tests/bundle.test.js tests/shared-data-pack.test.js`: 49 pass. Second cold review: accept with fixes, safe to copy to the live data repo; no path found where a release is published without a fresh signature. Still to apply (held while tests are paused):
  - A signing key of the wrong kind raises `Refused` (exit 3), so on a re-issue night it only warns. Make key problems exit 1, and make repeated refused re-issues visible (fail after N in a row, or record it in status).
  - No test fails when the loader fallback (`if rule is None: return None` in `pipeline/run.py`) or the prices step's `timeout-minutes: 15` is removed. Add both.
  - `_signer_improved_rule` catches only `OSError`, `ImportError`, `AttributeError`; a `SyntaxError` in the signer file crashes the night instead of meaning "do not re-issue".
- [x] X1b extension (done 2026-11-19. `wantsAutoRetry` is true only for a scan-confirmed row; the timer always calls `pickSet(idx, id, null, { auto: true })`; a row the user started a lookup on, or swapped the version of, never retries in that scan. Cold review: accept with fixes, no finding against the owner rule. Fixes applied: a retry answer is dropped unless the row still holds the card it was started for (`retryAnswerLands`); the auto path keeps the row's own identity; no retry starts while a picker or search is open; `replaceCard` keeps focus and caret in a search box through a re-render (found while testing: focus was lost when any price answer landed). `node --test tests/price-retry.test.js` 9 pass; `extension-wasm-popup.spec.js` 172 passed, run by the main session on a fresh build. The fixes after the review are covered by the final cold review of the whole extension change): correct the automatic price retry. The cold review rejected it: an unsure scanner guess with a failed price lookup is in the same Choose state as a failed user pick, so the retry would confirm a card the user never chose. Decision: retry only cards the scan itself confirmed, fetch the price only, never set a confirmation; skipped or removed rows never retry; a failed user pick stays manual. Tests: a low-certainty row with a failed batch price stays unconfirmed and unpriced; a scan-confirmed row gets priced without a click. Held while tests are paused. Until it lands, `dist/extension-wasm` holds the rejected code.
- [x] M1 phone app: download and list only the optional files the phone reads; a true message when one fails. Done 2026-11-18: the phone keeps only `ocr_det.onnx` and `ocr_rec.onnx` (`card_corners.onnx` was never read either). `npx tsc --noEmit` exit 0; `npx jest` 6 suites, 64 tests passed. Cold review: accept. Its notes, not acted on: no test for one OCR file present and one missing; a phone that already holds an unwanted file keeps it until the Settings download runs again.
- [x] R1 research: can `regression.npz` be rebuilt on this PC from data already here, under the README's definition? Answer 2026-11-18: no. The original 203 labelled crops and their `labels.json` are not on this PC (searched `C:\repos` and the home folder), and the old file holds vectors only, so it cannot be re-embedded. The old set is not `hibid-pack` (id overlap 1 of 84 and 9 of 896). The only untrained HiBid set here, `hibid-pack/eval`, has 40 machine-labelled id rows: too few and not human-checked. `hibid-pack/train` trained the recognizer and must not be used. Ready when crops exist: model `dist\release-v3.0\clip_visual_int8.onnx` has the right tag (`0dba1302580da2a6`), `card-scanner-data\.venv-gpu` runs the script, and the script to use is this repo's `tools/shared-data/scripts/build_regression.py` (the data repo's copy writes no tag). Owner decision: restore the crops, or approve a substitute gate.
- [x] R2 research: is a preregistered measurement possible on this PC for the three recognition findings (set code read as a second number, spaces around the slash, look-alike margin)? Answer 2026-11-18: no. Of 1,447 stored listing titles (866 from harvests, 581 from packs) none triggers the set-code fault (they are lot titles). No number-line OCR text is stored, and only 12 development boxes are tall enough to OCR. The look-alike path needs `data/hub-penalty.bin`, which no build contains, and an option that is off by default. Decision by the main session: fix all three as plain bugs with unit tests (slices X5 and X2), because each makes one spelling of an input behave like a spelling the code already handles, and no threshold changes. This is not a measured gain; the report says so.
- [x] X5 extension, two parser bugs: a set code next to a slash or `#` number is not a second card number (`lib/title-prior.js`); spaces around the slash do not lose the card number (`lib/card-number.js`). Done 2026-11-18. Cold review: accept with fixes; applied. The set-code rule was tightened after the review: only a slash number with a total of 20 or more, or a `#` number of two or more digits, switches the set-code pattern off, so "#1 Seller", "1/1" and a "9/10" grade keep the old result. The slash-space collapse skips lines over 200 characters. `node --test tests/title-prior.test.js tests/card-number.test.js`: 76 tests, 76 pass. Not measured on labelled data (none here triggers either bug). Known and accepted: "Charizard 4/102 Umbreon SWSH215" now reads as the one card 4/102, the same as "Charizard 4/102 Umbreon" always did.
- [x] N2 new sets reach installs by themselves (owner request 2026-11-19: "when a new set comes out, that the card information is automatically imported into GitHub"; a notice to installs to re-download card data is acceptable). State: the nightly job already builds new-card rows from TCGdex and publishes them on GitHub every night as a signed pre-release, and the extension already downloads the signed bundle and reads those rows. The one thing missing is `regression.npz` for the current recognizer; without it no night is marked as the live bundle. Candidate: the 3,363 name-labelled English boxes from real photos used by the preregistered study `card-scanner-data/data/reports/newsets-20261117` (labels are card names, not card ids, so the regression replay would score by name for those rows). Rule written down before any number is looked at: the ship rule for a night that only adds cards does not change (no fewer correct reads and no more confident wrong reads than before, on the regression set); only what counts as a correct read changes for a name-labelled row (the first hit's catalog name equals the labelled name, with the study's name normalisation). Research answer 2026-11-19: the embeddings exist (`.tmp/detect-qa/diag-20261113/emb.npy`, model tag `0dba1302`, the rows listed in the study's `realboxes.json`); the labels are names agreed by two independent model labellers, no human and no card ids; none of the five sets is training data, sealed, or forbidden; the gate compares exact ids (`pipeline/gate.py` `_replay`), and the nightly job has no id-to-name map for the shipped catalog.
  Rule fixed before any number of the new gate is computed (2026-11-19):
  - The regression file gets rows labelled by name. For each such row the file stores the label's base name and the list of shipped catalog ids whose base name equals it (resolved once, when the file is built, from the catalog's own names). Base name is the study's rule: lower case, curly apostrophe to straight, `'s` dropped, non-word characters to spaces, whitespace collapsed, then the tokens ex, v, vmax, vstar, vunion, gx, star, delta, δ dropped.
  - A name-labelled row is read right when the first hit is one of those ids, or is a new-card row whose own base name equals the label. Rows labelled by id keep exact id equality. "Confident wrong" follows the same right/wrong.
  - The ship rule for a night that only adds cards is unchanged: the correct-read rate after is not below the rate before, confident wrong reads do not rise, and the exam does not drop once it has 30 cards. No threshold changes.
  - All 3,363 boxes go in, all heights, with no selection by result. Whatever the first local run shows is reported; the rule is not adjusted to make a night ship.
  - First local night with this rule (2026-11-19, helper's run, 500 new cards replayed from the earlier dry run's rows, nothing signed or published): template tests 402, OK; the file has 3,363 rows, 24 with no shipped card of that name, 1,201 distinct names; plain first-hit search over the 19,796 non-digital rows gives 2,563 right, equal to the study. Gate replay: right 2,557 before and 2,561 after (2 lost, 6 gained), confident wrong 7 before and 8 after, 195 rows with a new card as first hit. Result: does not ship, because confident wrong reads rose by one. The rule was not changed.
  - Holding rule, fixed on 2026-11-19 after that result and before any run of it (main session's design; the owner can refuse it before anything is pushed): the cards-only ship rule stays as it is. When a cards-only night fails it, the job may hold back the new cards the replay blames and test the rest again with the same rule. Blamed means: a card added tonight that is the first hit of a regression row which is confident wrong after and was not before (when confident wrong reads rose), or which was right before and is wrong after (when the correct-read rate fell). At most 3 rounds, at most 10 held cards per night; more than that, a blamed row that is not one of tonight's cards, or a reduced night that adds no card, means nothing ships. Held cards are listed in the log and the status file with their ids and names, and are tried again every night. A night that changes a learned part never holds anything.
  - Second local night, with the holding rule (2026-11-19, same inputs, `.tmp/n2/dry2`): one round, one card held (`30th-077` Comfey, a confident wrong read on one regression row), 499 of 500 cards would ship (30th 152, swsh4.5sv 122, me06 99, swsh12.5gg 70, 2021swsh 25, 2022swsh 15, 2019sm 12, sm7.5 4); right 2,557 before and 2,562 after (1 lost, 6 gained); confident wrong 7 before and after; `improved: true`. Verified by the main session: `python -I -m unittest discover -s tests` 423 tests, OK; `node --test tests/bundle.test.js tests/shared-data-pack.test.js` 49 pass. Cold review: both changes accepted with fixes, none blocking; the fixes are applied (no hold when the exam's own confident wrong reads rose or are not reported, a trimmed night must pass that check too, a warning on the workflow run when a card is held, the README list of what the gate cannot see) and re-reviewed. Final template tests: 433, OK, none skipped; `dry3` and `dry4` equal `dry2`. Files for the push, when the owner asks: the template (`tools/shared-data`) and `.tmp/n2/regression.npz` (6,851,515 bytes) to the root of `main` of `fabcrowd/card-scanner-data`.
  - Known limits, to be stated wherever the gate is described: the labels are model-made; a same-name card from another set counts as right; the set has no photos of the new cards themselves, so it only catches harm to cards it contains.
  - Live 2026-11-19: the owner accepted the gate; pull request #2 of `fabcrowd/card-scanner-data` merged into `main` as `6e87d5a` (administrator bypass approved by the owner; local tests on the branch 487, OK, 10 skipped). N2 is done; the first scheduled night is the first real run.
- [x] D1 docs: both handoffs corrected, one current "left" list, old history moved to `docs/archive/` (`handoff-2026-11-14.md`), CHANGELOG, lessons. Done 2026-11-19.
- [x] C1 close-out, owner request "complete all tasks not done" (2026-11-19): a note in the scanner window when new card data arrived (`lib/card-data-note.js`); `rawTop` in the card-back and Japanese checks; `pictureAllowed` refuses a user name; one phone test; version 3.2.0; privacy-policy paragraph; USPTO exact-mark search recorded. Cold review: accept with fixes (set names read from the wrong field: fixed, re-reviewed, accept). Evidence: `npm test` 2,185 tests, 0 fail; lint exit 0; six browser specs 179, 4, 7, 3, 10, 1 passed; phone 65 tests; template 433, OK.
- [x] R3 release steps the owner asked for by name (2026-11-19): commits `c78ed13`, `0aa0bad`, `1f11a63` pushed on `feat/mobile-app`; release `installer` published with `Lotwise-Setup-3.2.0.exe` (SHA-256 `935878d2...53bb`) and `lotwise-version.json`, both downloaded back and equal; 3.2.0 installed on this PC (one manual reload in `chrome://extensions` still needed); `feat/blurry-training` of the data repo pushed.

Not doing, and why:
- The phone app on a device: no Android SDK or emulator on this PC.
- Japanese cards and newest sets on the phone: wait until the phone has run once and the nightly bundle ships.
- Blocking a redirect to a private address before the request: a service worker cannot read a redirect's target without following it; the response is already discarded by the check on the final address.
- An unattended download-and-run updater: the installer exe is unsigned, so nothing runs it without the user.
