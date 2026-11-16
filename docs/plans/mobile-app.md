# Mobile app plan (iOS and Android)

Status: **proposal, nothing built.** Written 2026-11-15 from a review of `README.md` and the
code it points at. This is a plan to decide on, not a report of work done.

Goal: a branded iOS and Android app built from this system, designed around photos taken on
the phone instead of photos found on a web page. The Chrome extension stays as it is.

---

## 1. The one-paragraph summary

The valuable part of this system is not the Chrome extension. It is about fifty-five small,
pure JavaScript modules that decide what a card is, how sure the scanner is, what to ask the
user, and what to remember, together with five ONNX models and a 512-dimension card catalog.
Only 8 of the 80 files in `tools/extension-wasm/lib/` touch a `chrome.*` API, and none of the
decision modules do. Moving to a phone means replacing three thin layers around that core:
where pictures come from (camera instead of a web page), how models run (onnxruntime-web
instead of a native runtime), and where data is kept (`chrome.storage` and IndexedDB instead
of a local database). The web-page machinery, about fourteen files, is deleted rather than
ported. The work that is genuinely new is a pricing backend, phone-sized model delivery, and
a refit of the confidence thresholds on camera photos.

---

## 2. Review of the README

The README is accurate and unusually complete; the repository map and the "Where to change
what" table are what made this plan possible to write without opening many files. Five things
matter for the mobile goal.

1. **The framing is wrong for a product.** The first line reads "Personal Windows toolkit"
   and the licence says "Private / personal use". A branded app needs a product README, a
   licence decision, and a support and privacy contact.
2. **The name is a legal risk on the app stores.** The product is called "Pokémon Card
   Scanner", the model releases live under `fabcrowd/pokemon-auto-lister`, and the data repo
   is `fabcrowd/card-scanner-data`. Apple and Google act on trademark complaints far more
   readily than the Chrome Web Store does, and The Pokémon Company pursues them. Pick a brand
   name that does not contain "Pokémon" and an icon that uses no Pokémon art, and use the word
   only descriptively in the store description. Decide this before any branding work, because
   it also sets the repo names, the bundle identifier, the icon and the relay host.
3. **Three unresolved blockers are inherited, not solved, by a new app.** The privacy-policy
   URL is still `TODO-OWNER`; the relay is public and unmoderated; the price snapshot is
   unsigned. All three are harder on a phone, because both stores require a working privacy
   policy URL and a data-safety declaration before review.
4. **The high-tier confirm cut-offs are already stale.** `docs/known-limits.md` records that
   0.82 and 0.025 were fitted on an older model and were not refit for the v3 recognizer.
   The mobile app changes the crop as well, so it must not inherit these numbers. See §7.
5. **Two entries say "purpose not stated in the file"** (`lib/price-prefs.js` and the
   `bench-round*.mjs` scripts). Honest, but in a public README it reads as a gap. Either
   document those files or drop them from the map.

Nothing in the README contradicts the code as far as this review checked.

---

## 3. Inventory: what moves, what dies, what is new

Measured on 2026-11-15 by searching `tools/extension-wasm/lib/` (80 modules). 8 modules
reference `chrome.*`, 6 reference `globalThis.ort`, 3 reference `indexedDB`, 1 references the
Cache API.

### 3.1 Ports with no change (about 55 modules, and their tests)

The identity and interaction brain. `fusion.js`, `stakes.js`, `choose-flow.js`, `why.js`,
`why-text.js`, `card-display.js`, `option-strip.js`, `journey.js`, `card-picker.js`,
`correction-save.js`, `correction-state.js`, `reference-bars.js`, `memory-confirm.js`,
`skip.js`, `lot-export.js`, `share-rows.js`, `contribution.js`, `draw-box.js`,
`not-card.js`, `tiny-card.js`, `card-back.js`, `frame-shadow.js`, `search.js`,
`adapter.js`, `refine.js`, `references.js`, `variant.js`, `bundle.js`, `title-prior.js`,
`page-prior.js` (the prior now comes from the lot rather than the page), the whole
`set-*.js` and `card-number.js` family, `era.js`, the stamp modules, `net.js`,
`photo-id.js`, `price-prefs.js`, `condition-pricing.js`, and the reader half of
`price-snapshot.js`.

These are plain ESM with no browser or Chrome dependency. The existing `node --test` suite
(1888 tests) runs against them unchanged, which is the main reason to keep them in JavaScript.

### 3.2 Needs an inference adapter (6 modules)

`detect.js`, `embed.js`, `corners.js`, `ocr.js`, `variant-model.js`, plus the check model
loaded through `bundle.js`. All of them call `globalThis.ort` and build an `OffscreenCanvas`.
The ONNX calls swap for a native runtime cleanly; the canvas work does not exist on a phone
and is the single largest porting cost. See the S2 spike in §6.

### 3.3 Needs a storage adapter (11 modules)

`pricing.js`, `ppt-key.js`, `price-snapshot.js`, `sharing.js`, `lot-session.js`,
`batch-price.js` and `pending-show.js` use `chrome.storage`; `corrections-store.js`,
`share-store.js` and `drawn-examples-store.js` use IndexedDB; `setup.js` uses the Cache API.
Define one small key-value interface and one small blob interface, implement each twice, and
these modules stop caring where they run.

### 3.4 Deleted on mobile (about 14 files)

Everything that exists because the input is a web page: `page-scan.js`, `page-focus.js`,
`page-target.js`, `rendition.js`, `full-size.js`, `photo-fetch.js`, `site-access.js`,
`gallery.js`, `tab-messaging.js`, `overlay-toggle.js`, `scanner-window.js`, `content.js`,
`photo-detection.js`, and the store package transform in `scripts/lib/store-package.mjs`
with its host and permission pins. The overlay interaction model survives as a concept:
boxes drawn over a photo the user took, in the app's own canvas, so `draw-box.js` and the
removal logic in `overlay-remove.js` still apply.

This deletion is the good news in the whole project. A large share of the extension's
complexity, its hardest bugs and its most fragile tests exist to read other people's web
pages. A camera roll has none of that.

### 3.5 Genuinely new (6 components)

1. **Capture.** Camera with a live viewfinder, multi-shot lot capture, and camera-roll import.
2. **Model delivery.** iOS On-Demand Resources or Android Play Asset Delivery for the 147 MB
   of models, replacing the GitHub Releases plus Cache API path in `setup.js`.
3. **A pricing backend.** Mandatory; see Phase 4.
4. **A local database.** SQLite for the lot, corrections, reference memory and the collection.
5. **A collection screen.** On a phone the saved collection becomes the centre of the product,
   not a by-product of a scan.
6. **Store compliance.** Privacy policy URL, data-safety form, Apple privacy manifest,
   account deletion if accounts exist, and an age rating.

---

## 4. Stack decision

**Recommendation: Expo React Native, with `onnxruntime-react-native` for inference and a
native module for image preprocessing. The shared core stays JavaScript.**

| Option | Verdict |
|---|---|
| **React Native (Expo) + onnxruntime-react-native** | **Chosen.** The 55 decision modules and their 1888 tests move unchanged. One copy of the confidence thresholds. One language for the owner to maintain. |
| Native Swift and Kotlin | Rejected for now. It means writing `fusion.js`, `stakes.js` and the choose flow twice, in two languages, and giving up the test suite that protects them. For a solo maintainer that is the worst outcome available. |
| Server-side inference, thin client | Rejected as the primary design, kept as the fallback. It adds a recurring GPU cost, needs connectivity at the moment the user is standing in a shop, and gives up the "everything runs on your device" promise the privacy policy is built on. If the S1 latency spike fails on real phones, this is where the project goes. |
| Flutter | Rejected. Much the same rewrite cost as native, with a weaker ONNX story. |

Two honest caveats. React Native's image pipeline is weaker than the browser's, which is
exactly why S2 is the first spike. And `onnxruntime-react-native` is less widely used than
`onnxruntime-web`; if it cannot run the int8 CLIP tower fast enough, the fallback is
converting that one model to Core ML and TensorFlow Lite and keeping the rest on ONNX.

---

## 5. Repository and code-sharing strategy

The owner's instinct was to branch the repo into another one. Do that, but with one change:
**carve the shared core into a versioned package before the fork, not after.**

The reason is visible in the README's own "Where to change what" table. Contribution schema
v1 already exists in three places that must agree: `lib/contribution.js`,
`tools/relay/src/validate.js` and `tools/shared-data/pipeline/contributions.py`. A plain fork
makes a fourth copy of every such contract, including the confirm thresholds. Two copies of
`fusion.js` that drift apart is a silent accuracy bug that no test will catch, because each
repo's tests will pass.

Proposed shape:

- `card-scanner-core` — a package holding §3.1 plus the adapter interfaces for inference and
  storage, with the existing tests. Consumed by path or git tag. Extracted from this repo so
  history is preserved.
- `auto card lister` (this repo) — keeps the extension, the Node dashboard, VellumAI, the
  relay, the shared-data pipeline and all training. Consumes `card-scanner-core`.
- `card-scanner-mobile` — the new app. Consumes `card-scanner-core`. Holds the capture UI,
  the native adapters, the SQLite layer and the store assets.
- `card-scanner-data` — unchanged. One data repo serves both clients.
- The pricing proxy lives in the mobile repo or beside the relay; see Phase 4.

Training, the catalog, the sealed test set and the nightly pipeline **stay in this repo
only**. There is no reason to copy models or data into the mobile repo, and the sealed set
must never be duplicated.

---

## 6. Phases

Every phase names the gate that has to pass before the next one starts. No phase that ships
recognition to a user may begin before Phase 5's refit exists.

### Phase 0 — Spikes, before any app code (the decision phase)

Five measurements. Any of them can change the stack, so do them first and skip none.

- **S1 Inference speed.** Run `clip_visual_int8.onnx` (89 MB) and `card_detect.onnx`
  (10.6 MB) through `onnxruntime-react-native` on one mid-range Android phone and one iPhone.
  Record milliseconds per crop and peak memory.
  *Gate:* detect plus embed for one card under about 1.5 s on a three-year-old phone. If not,
  convert CLIP to Core ML and TensorFlow Lite before continuing.
- **S2 Preprocessing parity.** The hardest and most important spike. Reproduce `rectify.js`
  and `embed.js` preprocessing without `OffscreenCanvas`, then prove the resulting embeddings
  match the web pipeline on a fixed set of fixtures.
  *Gate:* cosine similarity between web and mobile embeddings above a tolerance agreed before
  the spike, on at least 200 fixtures. `CLAUDE.md` records that a stretch-versus-centre-crop
  mismatch was the biggest accuracy bug this project has had; the catalog was embedded by
  `embed_all.py` and the query crop must still match it. If parity fails, nothing downstream
  is trustworthy.
- **S3 Catalog cost.** Measure the resident size of the decompressed catalog
  (`catalog.bin.gz` is 42.2 MB of gzipped L2-normalised float32 at 512 dimensions) and the
  time for one brute-force search on a phone.
  *Gate:* one search under about 50 ms, and the app survives a memory warning with the
  catalog and a CLIP session both live.
- **S4 Asset delivery.** Ship the 147 MB through On-Demand Resources and Play Asset Delivery
  in a throwaway app, including a resumed download and a failed one.
  *Gate:* a first run that downloads the models once and survives being killed mid-download.
- **S5 Distribution check.** Take about 100 camera photos of the owner's own cards and run
  them through the **existing** extension pipeline. Record confirm, choose and abstain rates.
  *Gate:* none. This is the number that sizes Phase 5, and the first evidence of how different
  camera photos are from marketplace listing photos.

Deliverable: a one-page spike report with the five numbers. Decision point for the owner.

### Phase 1 — Extract `card-scanner-core`

Move §3.1 into the package with its tests. Define two interfaces: an inference adapter
(`loadModel`, `run`) and a storage adapter (key-value plus blobs). Make the extension consume
the package and prove nothing changed.

*Gate:* `npm test` at the same count as before (1888 pass), lint clean, the extension dev
build loads and scans a page as it did, and the store build's permission pins still pass.
This phase must be behaviour-neutral for the extension.

### Phase 2 — Mobile shell and adapters

New repo. Expo app, the ONNX adapter from S1, the preprocessing adapter from S2, the SQLite
storage adapter, and model delivery from S4. No product UI yet: one debug screen that takes a
photo and prints the detected boxes and the top catalog matches.

*Gate:* the parity harness from S2 runs on a real device build in CI, and one photo of one
card produces the same top match as the extension does on the same photo.

### Phase 3 — Capture-first product design

The phase where the product stops being a port. The design centres on photos taken on a
phone, so:

- A viewfinder that shows boxes live and says when the shot is good enough (framing, glare,
  focus), rather than failing silently after the shot.
- Lot capture: many cards in one photo, or many photos in one lot, with a running lot value.
- The confirm flow from the 2026-11-15 redesign carried over, since it is already built and
  tested: to confirm, versions to pick, priced, high value, left out. On a phone these become
  one scrolling review with large card images and thumb-reachable actions.
- Undo everywhere, as in the extension.
- The collection as a first-class screen: saved lots, totals over time, export.

*Gate:* a build the owner uses on real cards for a week, and a written list of what the phone
makes worse than the extension did.

### Phase 4 — Pricing backend

A phone app cannot hold the pricing keys. JustTCG, PokemonPriceTracker, eBay, PokéWallet and
TCGPlayer keys inside an app bundle are extractable, so a small proxy is required, not
optional.

Good news from the review: `src/pricing/pricing.js`, `priceGrid.js` and the price clients are
plain ESM with dependency injection and no Node built-ins, apart from one
`node:timers/promises` import in `pokemonTcgApi.js`. They can move to a Cloudflare Worker
beside the existing relay almost unchanged, keeping the rules that matter: median of comps,
`MIN_COMP_SOURCES` of 2, and the 15 percent needs-review threshold.

Also needed: per-install rate limits, a response cache, and a degraded mode so the app still
names cards with no network.

*Gate:* the worker's tests plus the ported pricing tests pass; the app prices a lot with no
keys on the device; and a network-off run still identifies cards and says prices are
unavailable rather than guessing. Deploying the worker is an owner step.

### Phase 5 — Refit identity on camera photos

Non-negotiable, and the reason Phase 3 must not ship as it stands. `CLAUDE.md` states that
the thresholds in `lib/fusion.js` are fitted to one model, one crop and one catalog, and must
be refit whenever any of the three changes. The mobile app changes the crop and the input
distribution at once. Inheriting 0.82 and 0.025 would move the error rate in an unknown
direction, on top of the stale-cut-off limit the README already records.

Steps, in order:

1. Build a labelled camera-photo set of the owner's own cards, large enough to fit on and
   hold back from. It must not overlap `data/sealed-test/`.
2. **Preregister** the change: what is being fitted, on what data, and which metric decides,
   written down before any number is looked at. This is the repo's existing rule.
3. Refit accept, abstain, `HIGH_TIER_SIM` and `HIGH_TIER_GAP` on that set.
4. If the preprocessing differs from the web path at all, bump `EMBEDDING_VERSION`
   (currently 3). Saved corrections and signed bundles made under another version are not
   comparable, and `bundle.js` already refuses a bundle built for a different model and crop.
5. Keep `data/sealed-test/` sealed. It is scored once, only when the owner asks, and only the
   totals are reported.

*Gate:* a written study with a held-out score. The sealed run happens only if the owner asks
for that step by name.

### Phase 6 — Persistence and sync

Fix on the phone what the README lists as a limit on the extension: popup state is lost when
the popup closes. Losing an in-progress lot on a phone is unacceptable, so the lot, the picks,
the skips and the corrections all live in SQLite from the first version.

Decide here whether there are accounts. No accounts means no sync, no server-side collection
and no account-deletion obligation, which is much faster to ship. Accounts mean multi-device
and a basis for paid tiers. Recommendation: ship without accounts, and design the schema so a
later sync is possible.

### Phase 7 — Shared learning on mobile

The relay and the signed-bundle loop port with almost no change, because they are plain HTTP
plus schema v1. Add a platform field to the contribution so mobile and extension data can be
told apart, which the nightly consensus will want. Keep it opt-in and off by default, and
keep the unmoderated-relay decision from `docs/known-limits.md` open until it is answered,
because a published app raises the stakes of a public, permanent image inbox.

*Gate:* the schema change applied in every place that pins it, with the contract tests
updated in the same change: `lib/contribution.js`, `relay/src/validate.js`,
`shared-data/pipeline/contributions.py`, `tests/contribution.test.js`,
`tests/relay-validate.test.js`.

### Phase 8 — Store readiness

The privacy policy URL becomes real, the data-safety form and Apple privacy manifest are
filled in, the brand name is settled per §2, screenshots are taken without third-party
listing photos in them, and the known limits are restated for a consumer audience:
non-English cards may price as English, slabs and sealed product are not detected, stamped
printings price as the regular card.

### Phase 9 — Launch

TestFlight and a Play internal track first, with the owner's own cards and a small number of
testers. The Chrome extension's store submission is a separate decision and need not block
this.

---

## 7. The three risks that decide the project

1. **Preprocessing parity (S2).** If the mobile crop does not match how the catalog was
   embedded, accuracy collapses and every threshold becomes meaningless. This has already
   happened once in this project's history. It is the first thing to prove and the thing to
   keep proving in CI.
2. **The thresholds do not transfer (Phase 5).** Camera photos are not marketplace listing
   photos. Shipping the web numbers would be guessing, and the README already flags the
   current numbers as fitted on an older model.
3. **Two copies of the brain (Phase 1).** A plain fork duplicates `fusion.js` and the schema
   contracts. They will drift, both test suites will stay green, and the divergence will show
   up as unexplained accuracy differences months later. Extracting the core first is cheap
   insurance.

A fourth, not technical: the app name. A trademark complaint after launch costs more than
choosing a different name now.

---

## 8. Open decisions for the owner

1. Brand name, and whether the repos and the relay are renamed with it.
2. Accounts and sync in version one, or no accounts.
3. Free, paid or subscription, and whether pricing lookups are metered.
4. iOS and Android together, or iOS first.
5. Does the extension stay alive and get shipped, or does the phone app replace it?
6. The unmoderated-relay decision from `docs/known-limits.md`, now that a public app would
   feed it.
7. Who owns the mobile code's design: surgical changes as in this repo, or a free hand in the
   new one.

---

## 9. What is not in this plan

No code, no repo creation, no dependency added. Nothing in this document has been built.
