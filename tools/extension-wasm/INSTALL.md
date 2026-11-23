# Lotwise — Install

A Chrome extension that scans the Pokémon cards on any webpage and overlays
market prices (NM / LP / MP / HP / DMG + graded).

Works fully offline after the one-time model download. No account required.

---

## Easy path (Windows installer)

If someone sent you **Lotwise-Setup-*.exe**, or you downloaded it from the
project’s `installer` release, use that. Full steps (SmartScreen, Chrome
clicks, update, remove): [`docs/store/install.md`](../../docs/store/install.md).

In short: run Setup → when the guide opens, turn on Developer mode → Load
unpacked → paste the folder from the guide → pin Lotwise → **Download models**.
Optional: Settings → License → activate `LOTWISE-TRIAL` for newest sets while
Lotwise is in preview (core scanning stays free without a key).

---

## Developer path (load unpacked from this repo)

1. **Build the extension** (from the repo root):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1
   ```

2. **Open Chrome's extension page.**
   Paste this into the Chrome address bar: `chrome://extensions/`

3. **Enable "Developer mode"** (toggle in the top-right of that page).

4. **Click "Load unpacked"** (button that appears top-left), then pick
   `dist/extension-wasm/` (all files in that folder must stay together).

5. **Pin the extension** so the icon is always visible: click the puzzle-piece
   icon in Chrome's toolbar, find "Lotwise", click the pin.

6. **First launch — download the models.**
   Click the scanner icon in the toolbar. A small window opens. Click
   **Download models**. This downloads about 147 MB of card-identification data
   and takes 1–3 minutes. **SCAN PAGE** stays off until that finishes.

Once the pill in the top-right reads **AI ready**, you're set.

Already set up an earlier version? After updating, the scanner asks you to
**Download models** once more. It only fetches the new card finder (~10 MB);
the other files are kept.

---

## Using it

1. Open any webpage with Pokémon card images (TCGPlayer, eBay, Collector's Cache,
   a Google image search, your own gallery — anything).
2. Click the scanner icon. The popup opens.
3. Click **SCAN PAGE**.
4. Each card gets a badge with its name, set, and price. When several
   variants share the same art, the badge shows the price range. Pick the
   variant in the popup. The lot total skips that card until you do.
5. The popup lists the cards. Condition chips (NM / LP / MP / HP / DMG)
   change which price is shown when the source has a full grid.

Hit **CLEAR** or scroll elsewhere to dismiss the overlay.

---

## Price sources (automatic)

The scanner picks the best price source available, in this order:

| Priority | Source | Gives you | Setup |
|----------|--------|-----------|-------|
| 1 | **JustTCG** via the local dashboard (`http://127.0.0.1:3000`) | Per-condition + graded | Install the dashboard and run `npm start` |
| 2 | **Price Tracker** (PokemonPriceTracker.com) | Per-condition NM/LP/MP/HP/DMG + PSA/BGS/CGC/SGC | Free API key, paste in Settings |
| 3 | **TCGPlayer** via pokemontcg.io | Market price per printing | Nothing — always available |

The scanner uses whichever source answers. Each card's badge names that
source (JustTCG, Price Tracker, or TCGPlayer).

### Optional: free PokemonPriceTracker key (recommended)

Unlocks the full NM/LP/MP/HP/DMG grid and graded prices.

1. Right-click the scanner icon → **Options**
   (or click the ⚙ button in the popup header).
2. Click **Get a free key** to open PokemonPriceTracker's signup
   (free tier: 100 lookups/day).
3. Paste the key into the field and click **Save**.

Done. The next scan uses PPT automatically.

### Optional: local backend (for the pokemon-auto-lister dashboard users)

If you also run the dashboard (`npm start` in the parent repo) with a
`JUSTTCG_API_KEY` in your `.env`, the scanner picks it up automatically. The
Settings page shows a green **backend + grid** pill when the server is reachable.

---

## Troubleshooting

**"Setup needed" pill stays on.** Models didn't download. Click **Download
models** in the popup. Check Chrome's console (right-click popup → Inspect) for
network errors.

**"No Pokémon cards detected on this page."** The scanner looks for card-shaped
pictures, including ones painted as a CSS background. Pictures inside another
site's frame are not visible to it.

**"Card pictures are still loading."** The page drew the card frame before the
photo arrived. Wait a second and scan again.

**Prices look wrong.** Variants that share the same art (Base Set unlimited,
Shadowless, 1st Edition) cannot be told apart from the picture. The badge
shows the price range. Use the **Variant** menu in the popup. That card stays
out of the lot total until you pick one.

**Settings says the local dashboard is "Not detected".** Only matters if you
installed the dashboard. Make sure `npm start` is running and your `.env` has
`JUSTTCG_API_KEY`.

**Overlay doesn't appear.** The scanner can't inject into Chrome's internal
pages (`chrome://`, `chrome-extension://`, the Web Store). Open an actual
webpage first.

---

## Permissions and privacy

- **`activeTab`** — read the content of the tab you're currently viewing when
  you click the scanner icon.
- **`scripting`** — inject the overlay into pages that were open before install.
- **`storage`** — save your filter preferences and PokemonPriceTracker key.
- **`<all_urls>`** — overlay the scan results on any webpage.

Nothing leaves your machine except:
- Image fetches from GitHub Releases (one-time, during setup — the AI models)
- Price lookups from pokemontcg.io / PokemonPriceTracker / your local backend

No telemetry, no analytics, no account.
