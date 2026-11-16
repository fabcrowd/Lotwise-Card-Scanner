# Brand

Status: **the name is applied in the extension** (owner approved it on 2026-11-15; see §7 for
the evidence and what is still open). Written 2026-11-15, name revised the same day after a
second availability search. The brand covers both the Chrome extension and the phone app in
`docs/plans/mobile-app.md`, because they share a relay, a data repo and a privacy policy.

---

## 1. The name

**Sweep.**

Extension and app name: **Sweep**
Store name: **Sweep: Card Scanner & Price Checker**
Tagline: **One pass. Every card.**

The store name keeps the descriptive keywords the old one had and drops only the trademark:
"Card Scanner & Price Checker for Pokémon TCG" becomes "Sweep: Card Scanner & Price
Checker". The word Pokémon stays in the listing body, where it is factual description rather
than the product's name.

Why this name:

- **It names the capability the product is built around.** One pass over a whole page or a
  whole lot, rather than one card at a time. A sweep covers an area; that is the gesture in
  both products, a marketplace listing page in the extension and a pile on a table on the
  phone.
- **It is a verb, so the interface can use it.** "Scan Page" becomes **Sweep page**. The
  status line reads "Swept 9 cards · 4 need you". The word does product work, not just
  marketing work.
- **"A clean sweep" means nothing was missed**, which is the promise, and it sits next to the
  honesty promise in §2 rather than fighting it: it finds all of them and says which ones it
  is unsure of.
- **It is clear of this category.** A search of the App Store listings and the review guides
  on 2026-11-15 turned up no trading-card or collectibles app called Sweep. It carries no
  Pokémon association, so it survives a trademark complaint and does not need changing if
  Magic, Yu-Gi-Oh or sports cards are added later.
- **Four letters, one syllable**, easy to say and type, and short enough to be a wordmark
  rather than a picture.

One check to run before committing: a USPTO search for SWEEP in classes 9 and 42. There are
unrelated fintech and carbon-accounting products using the word, which is normal for a common
English word in a different class, but it is a ten-minute check and it is cheaper now than
after launch.

### Names that were rejected, and why

Searched 2026-11-15. The category is crowded and most obvious names are gone.

| Name | Why not |
|---|---|
| Anything with "Pokémon" or "Poké" | The current names, and the actual risk. A Pokédex app was removed from Google Play under the impersonation policy, with the name and description as the trigger and official art in the screenshots as the second problem. Apple's lever is guideline 4.3(a), Copycats. The category is full of these anyway: PokeLenz, PokeHolo, PokiFrame, PokeScope, Pokex, "Poké: TCG Scanner". |
| Anything ending in `-dex` | Reads as Pokédex, a Pokémon Company mark, and the space is saturated: DittoDex, DexTracker, MyDex, BinderDex, Ludex. |
| Loupe | Taken prominently. Loupe Tech's "Loupe - Sports Trading Cards" has about 2,600 ratings. The internal module `lib/loupe.js` can keep its name; it is not user-facing. |
| Binder | Taken repeatedly: Binder, Card Binder, TCG Binder, Binder: Sports Card Tracker, Card Grading: Pocket Binder, BinderDex. |
| Anything `-Lens`, `-Viz`, `-ly AI` | FoilLens, TCGLens, PokeLenz, CViz, Cardly AI. This is the category's default naming pattern and blends straight into it. |
| Haul | The earlier recommendation. It names the batch but not the scan, and the owner's brief is the sweep itself. Kept as a fallback if Sweep fails a trademark check. |

### Alternates, if Sweep does not survive the trademark check

All three were searched on 2026-11-15 and none appears in this category.

1. **Lotwise** — by the lot, and knows what it is worth. A coined compound, so the strongest
   mark of the set. Says lots but says nothing about pages.
2. **Tally** — the running total of a whole lot. Names the output rather than the input, which
   suits the lot-value screen but not the page scan.
3. **Flatlay** — the photographic term for shooting objects laid out and seen from above,
   which is exactly how a card lot gets photographed. Distinctive and unused here, but it
   reads as a photography word to people outside photography.

---

## 2. Positioning

**One pass over the whole thing, and it tells you what it is unsure of.**

A correction to an earlier draft of this document, because it changes the claim: scanning
many cards at once is **not** unique. Collectr scans a full binder page of nine. PokeLenz and
PokiFrame advertise full-page and batch scanning. DexTracker sells an "AI Multi Card Scanner".
Pokex is aimed squarely at bulk lots. Any marketing that claims multi-card scanning as the
innovation would be making a claim the category already makes.

Two things are genuinely different, and the brand rests on those.

**First, the photo was not set up for scanning.** The competitors' bulk mode expects a binder
page: nine cards, a grid, flat, lit, one per pocket. This product was trained and measured on
a stranger's marketplace listing photo and on an unsorted pile, with overlap, tilt, glare and
an unknown card count. The detector's own fixtures are Facebook Marketplace and HiBid lots
(`tools/vellum-ai/detect/marketplace_cases.json`), and the extension reads a whole web page,
which nothing else in the category does at all. The phrase to use is "a photo of a pile", not
"multi-card scanning".

**Second, it does not guess.** This is already the product's rule rather than a brand
invention: the README says it leaves out a card it cannot price instead of guessing a price,
an unconfirmed price is always marked unconfirmed, and `lib/stakes.js` keeps price from ever
deciding confirmation. The category's accuracy claims are self-published, up to a 98.1 percent
first-scan figure, and the recurring review complaint is foils and variants priced as the
wrong printing.

So: **Sweep finds every card in one pass, and marks the ones it is not sure about.**

What that rules out: "instant AI valuation", any accuracy percentage the sealed set has not
backed, and a hero screenshot showing a tidy grid of confident prices. The honest screenshot
is the "4 need you" state, which is also the more interesting one.

---

## 3. Voice

The UI wording rules already in the repo stay as they are: say "version", "unconfirmed" and
"skip"; never "printing", "variant" or "finish". Add "sweep" as the word for a scan, used
consistently. Extend the rules to everything else the brand writes.

- Plain, calm and specific. "Found 9 cards · 4 need you" is the house style.
- Never claim certainty the scanner does not have, and never publish an accuracy number
  without the held-out set behind it.
- No hype words: no "instantly", "magically", "powered by AI", "revolutionary".
- Address one person doing one job, not "users" or "collectors".
- Say what a thing costs or takes. The 147 MB download is stated plainly, up front.

---

## 4. Visual identity

### The mark

**The four corner brackets.** The overlay already draws corner brackets around every card it
finds; that is the product's own visual language and nobody else in the category uses it. The
logo is those four brackets with nothing inside them. It works at 16 px, it works as a
monochrome stamp, it holds no card art, and it means "this is what I found". For the sweep
idea it can also animate: brackets snapping onto several cards in sequence, one pass across
the frame.

### Palette

Amber is already the brand colour in use: the README's one-time colour key reads "Amber: pick
the card". Build on it. One accent, a dark neutral ground, and a quiet positive for confirmed
cards.

### Type

Already chosen and already in the repo: Bricolage Grotesque for display and Figtree for text,
both variable woff2 with their OFL licences, in `tools/extension-wasm/ui/fonts/`. Design
tokens are in `ui/tokens.css`.

### What to avoid, specifically

The category has a strong default look, and so does generated design work. Avoid all of it:

- Pokéball red and white; Pokémon logo yellow on blue.
- Holographic rainbow gradients. Nearly every competitor icon is one.
- A fan of cards, a magnifying glass, or a phone photographing a single card. All three are
  taken several times over.
- Cream or off-white backgrounds; italic accent words in headlines; numbered "01 / 02 / 03"
  section labels; monospace labels used as decoration; pill-shaped buttons.
- Official card art anywhere in the icon, screenshots or promo images. This is the second
  thing that got a Pokédex app removed from Google Play, after its name.

Screenshots use the owner's own cards and his own photos, never a seller's listing photo
pulled off a marketplace.

---

## 5. Timing: do this before submission, not after

The extension has **not** been submitted to the Chrome Web Store, and the phone app does not
exist. There is no installed base and no listing to migrate, so the rename costs nothing
today. After submission it costs a store transition, a new listing identity and confused
existing users. This is the cheapest moment the project will ever have.

---

## 6. Change list

About 75 tracked files mention the current name. Most are history and need no edit. These are
the ones that matter, grouped by what breaks.

### 6.1 User-visible strings

- `tools/extension-wasm/manifest.json` — `name` is "Pokémon Card Scanner".
- `scripts/lib/store-package.mjs` — `STORE_NAME` is
  "Card Scanner & Price Checker for Pokémon TCG".
- `tools/extension-wasm/popup.html`, `options.html` — titles and headings.
- `tools/extension-wasm/lib/card-display.js`, `lib/site-access.js` — strings shown to the user.
- `tools/extension-wasm/INSTALL.md`.
- `docs/store/listing.md`, `docs/store/privacy-policy.md`.
- `README.md` — the title, the "Personal Windows toolkit" framing and the licence line.

### 6.2 "Scan" becomes "Sweep" in the interface

A separate decision from the rename, and worth making at the same time so the wording changes
once. The strings live in `tools/extension-wasm/lib/journey.js` (scan status, notices) and the
button in `popup.html`. Their tests are `tests/journey-text.test.js` and
`tests/journey-fixes.test.js`. Keep "scan" in code identifiers, message names and the CSV
headers, which existing spreadsheets depend on; change only what the user reads.

### 6.3 Contract-pinned tests that will fail, by design

These exist to catch exactly this kind of drift, so each is a deliberate edit in the same
change rather than a surprise: `tests/store-build.test.js`, `tests/store-transform.test.js`,
`tests/card-display.test.js`, `tests/journey-text.test.js`, `tests/options-layout.test.js`,
`tests/site-access.test.js`, `tests/extension-setup.test.js`, and the Playwright specs
`tests/e2e/extension-chrome.spec.js`, `extension-visual.spec.js`,
`extension-wasm-popup.spec.js`, plus `tests/e2e/ui-states.mjs` and `live-scan.mjs`.

### 6.4 Do not rename: the model release host

`tools/extension-wasm/lib/setup.js` downloads every model from
`github.com/fabcrowd/pokemon-auto-lister/releases/download/`, pins each file by sha256, and
the Cache API keys the files **by URL**. Renaming that GitHub repository changes those URLs
for every build, including ones already installed. Leave the asset-hosting repo name alone, or
move the assets deliberately under a new release tag and bump the pins and `CACHE_NAME`
together. `tools/shared-data/pins.json` points at the same assets.

The relay host (`card-scanner-relay.fabcrowd.workers.dev`) is in `lib/shared-config.js`, and
changing it changes what every build talks to. Renaming it needs a deploy of the new worker,
both hosts live through the overlap, and a `tests/store-build.test.js` change, because the
host list is pinned there.

### 6.5 Leave alone

Internal module and folder names (`lib/loupe.js`, `tools/vellum-ai/`, `card-scanner-data`,
`auto card lister`), everything under `docs/archive/` and `docs/autopilot/`, the benchmark
scripts, and `tasks/` history. None is user-visible, and renaming them only makes the history
harder to read.

---

## 7. What was applied, and what is still open

### Applied on 2026-11-15

The owner approved the rename, and §6.1 and §6.3 were applied in the working tree on
`feat/price-follows-pick`. They were not put on a separate branch after all: the tree already
held the uncommitted UI redesign and a second worker was building under `mobile/`, so a branch
would have shared the same working tree and isolated nothing. **Nothing was committed.**

Changed: `tools/extension-wasm/manifest.json` (`name` is now "Sweep"),
`scripts/lib/store-package.mjs` (`STORE_NAME`), `popup.html`, `options.html`,
`lib/card-display.js`, `lib/site-access.js`, `background.js`, `INSTALL.md`,
`scripts/render-icons.mjs` (the text drawn into the icon), `docs/store/listing.md`,
`docs/store/privacy-policy.md`, `README.md`, and nine test files that pinned the old name.

Evidence: `npm test` 1899 tests, 1898 pass, 0 fail, 1 skipped. `npm run lint` 4 errors, all
pre-existing `no-undef` in `mobile/babel.config.js` and `mobile/metro.config.js`, which are
another worker's untracked files and were left alone.

`tests/store-transform.test.js`, `tests/extension-setup.test.js` and
`tests/e2e/live-scan.mjs` turned out not to pin the name and are unchanged.

A cold review of the diff accepted it and found no defect in the rename. It confirmed that no
test was deleted, skipped or weakened; that `tests/store-build.test.js` changed only its two
`manifest.name` expectations and still pins the same permission and host list; and that
`lib/setup.js`, `CACHE_NAME` (still `cardscanner-models-v2.1p`), `lib/shared-config.js` and
`tools/shared-data/pins.json` were not touched. Renaming `CACHE_NAME` would have orphaned
every installed model cache, so leaving it alone was the point.

The review flagged two sentences it could not attribute from the diff, because `git diff`
compares against HEAD and the UI redesign's uncommitted wording is mixed in: the reload
message in `lib/card-display.js` and `accessOfferText` in `lib/site-access.js`. Both are the
redesign's, not the rename's. The strings captured before the rename ran already read "Reload
Card Scanner at chrome://extensions, then press Scan Page." and "Let Card Scanner read the
original photos on …", and `tests/card-display.test.js` and `tests/site-access.test.js` were
both already modified at the start of the session. Only the product name changed in them.

### Still open

- **`mobile/app.config.ts`** still sets `name: 'Pokémon Card Scanner'`. It belongs to the
  worker building the phone app and was left untouched to avoid a concurrent edit. That
  worker needs to be told the name is Sweep.
- **`npm run lint` is red** on `mobile/babel.config.js` and `mobile/metro.config.js`, which
  need CommonJS globals in `eslint.config.js`. Not caused by the rename.
- **The "scan" to "sweep" wording change (§6.2) was not made.** The interface still says
  "Scan Page". It is a product decision and it touches the same strings the UI redesign is
  moving.
- **Deliberately left with the old name:** `src/index.js` server log line,
  `tools/chrome-extension/` (the older dev extension), `tools/vellum-ai/` scripts and specs,
  the `ui/*.css` header comments, and the continuity docs under `docs/`. None is
  user-visible in the shipped extension.
- Whether the icon and promo images get drawn now or at Phase 8 of the mobile plan.
- A USPTO check on SWEEP in classes 9 and 42, per §1.
