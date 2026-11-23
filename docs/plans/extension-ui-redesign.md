# Extension UI redesign: "Slab and viewfinder" (2026-11-14)

Design spec for the popup window, setup wizard and options page of `tools/extension-wasm/`.
The owner asked for a consumer-ready redesign focused on ease of use and simplicity.
This file is the single source for builders. It changes how things look and are laid out. It does not change what the scanner decides, what a price means, or any wording that tests assert.

## 1. Direction

The product reads a marketplace photo, names each card and prices the lot. The redesign makes three things obvious at a glance: what the lot is worth, which cards still need the user, and what to press next.

- **Slab.** Every card is a "slab": one rounded container with the photo crop on the left, the name and set line in the middle and the price on the right, like the label on a graded card. The picture comes first because collectors recognise cards by art, not by text.
- **Viewfinder.** The brand mark is the store icon's idea: a card inside four corner brackets. The brackets (amber) mark anything the scanner is looking at or asking about: the logo, the scanning state, the "On the page" crop, the empty state.
- **One hero number.** After a scan the lot card shows one large figure, the confirmed value, with the counts under it. The old second figure in the action bar is hidden.
- **Color means state, nowhere else.** Green is confirmed, blue is "pick the printing", amber is "the scanner asks you", grey is not recognised, red is an error. These are the same colors the page overlay already draws. Buttons are ink (near-black in light, near-white in dark), so a colored thing is always a state.
- **Foil, once.** A thin cyan-violet-amber strip on the top edge of the lot card and in the setup progress bars is the only gradient. No purple gradients, no glow, no pill clusters.
- Light and dark both designed; the page follows `prefers-color-scheme`.

Research behind it (2026-11-14): Collectr, TCGplayer, Dragon Shield, Ludex, CollX, Pokellector, PriceCharting and card sites agree on these patterns: a scan result is a preview until confirmed; the printing is an explicit picture pick; name line is "Name, Set, #number"; one labelled price; a failed read says why and offers search. Common complaints are wrong printing giving a wrong price, unlabeled prices and no recovery path. The current product rules already cover these; the redesign makes them visible.

## 2. Files

- `tools/extension-wasm/ui/tokens.css`: `@font-face`, tokens, base elements, shared components (buttons, switch, chips, notices, inputs, focus).
- `tools/extension-wasm/ui/popup.css`: the popup and wizard. Replaces the inline `<style>` in `popup.html`.
- `tools/extension-wasm/ui/options.css`: the options page. Replaces the inline `<style>` in `options.html`.
- `tools/extension-wasm/ui/fonts/`: two variable fonts (latin subset, woff2) and their license files as `.txt` (the store build bans `.md`).
- The build copies every file under `tools/extension-wasm/` to `dist/`, so no build list changes.
- `content.js` (the page overlay) is not changed: its state colors are the source the popup now matches, and its tags already read well on photos.

## 3. Tokens

Custom properties on `:root`; dark values under `@media (prefers-color-scheme: dark)`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F3F3F7` | `#0F0E1A` | window background |
| `--surface` | `#FFFFFF` | `#191729` | slabs, header, dialogs |
| `--surface-2` | `#F7F7FA` | `#211F36` | inset areas, tiles, inputs |
| `--border` | `#E2E2EA` | `#2E2B47` | hairlines |
| `--border-strong` | `#8A889F` | `#7572A0` | control borders (inputs, selects, switch track, ghost buttons): 3:1 on every surface |
| `--ink` | `#17152B` | `#EFEEF8` | primary text |
| `--ink-2` | `#4A4862` | `#C3C1D9` | secondary text |
| `--ink-3` | `#6B6982` | `#9D9AB8` | muted text (still 4.5:1) |
| `--primary-bg` | `#17152B` | `#EFEEF8` | primary button fill |
| `--primary-bg-hover` | `#2A2748` | `#FFFFFF` | |
| `--primary-fg` | `#FFFFFF` | `#17152B` | primary button text |
| `--brand` | `#5B3FE6` | `#A795FF` | links, selection ring, focus ring |
| `--brand-tint` | `#EEEAFE` | `#2A2356` | selected tile fill |
| `--ok` | `#0B7A53` | `#3DD9A0` | confirmed text and icons |
| `--ok-fill` | `#10B981` | `#10B981` | confirmed rail |
| `--ok-tint` | `#E3F6EE` | `#10372B` | |
| `--info` | `#1D5FD6` | `#7FB0FF` | pick-printing text |
| `--info-fill` | `#3B82F6` | `#3B82F6` | pick-printing rail and ring |
| `--info-tint` | `#E6EEFC` | `#14294F` | |
| `--ask` | `#9A5300` | `#FBBF24` | choose text |
| `--ask-fill` | `#F59E0B` | `#F59E0B` | choose rail, viewfinder brackets |
| `--ask-tint` | `#FFF3D9` | `#3A2A08` | |
| `--none-fill` | `#9CA3AF` | `#9CA3AF` | not-recognised rail |
| `--danger` | `#B42318` | `#FF8A80` | errors, remove hover |
| `--danger-tint` | `#FDECEA` | `#45181A` | |
| `--foil` | `linear-gradient(90deg,#22D3EE,#8B5CF6,#F59E0B)` | same | lot card top edge, progress fill |
| `--shadow` | `0 1px 2px rgba(23,21,43,.06), 0 4px 12px rgba(23,21,43,.05)` | `none` | raised slabs |

The `*-fill` values equal the overlay's `STATE_COLORS` in `content.js`.

Type:
- `--font-display`: `"Bricolage Grotesque", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`. Logo, hero figure, card names, section and dialog titles, primary button labels.
- `--font-text`: `"Figtree", "Segoe UI", system-ui, sans-serif`. Everything else.
- Sizes: 12, 13, 14 (body), 16, 20, 28 px. Nothing under 12 px. Line height 1.45 for text, 1.15 for display.
- Prices and counts: `font-variant-numeric: tabular-nums`.
- Uppercase only for the scan button label and 12 px section labels (letter-spacing .06em).

Space, shape, motion:
- 4 px grid: 4, 8, 12, 16, 20, 24.
- Radius: 6 (chips, set code), 10 (buttons, inputs, tiles, notices), 14 (slabs, lot card, dialog).
- Control heights: 44 (scan, clear, era, wizard buttons), 40 (confirm, search input, dialog buttons), 32 (small buttons), 28 minimum for any click target.
- Focus: `outline: 2px solid var(--brand); outline-offset: 2px` on `:focus-visible` for every control. Never removed.
- Motion: `--dur-fast: 120ms`, `--dur: 180ms`, `--ease: cubic-bezier(.2,.8,.2,1)`. Motion is limited to: hover/press on controls (press scales to .98); the scanning state (a sweep on the scan button, and a scan line with pulsing brackets on the empty-state picture); the switch, chevron and progress-bar transitions; and the outline flash on a row the page asked to show. No entry animation on result rows: the list is redrawn on every pick and would flicker. All motion off under `prefers-reduced-motion: reduce`.
- Icons: inline SVG, 24 viewBox, `stroke="currentColor"`, 1.75 stroke, round caps. No emoji or glyph characters as icons in HTML.
- Accessibility floor: text pairs 4.5:1 and control boundaries 3:1 in both schemes (computed from the token values on 2026-11-14), a `@media (forced-colors: active)` block per stylesheet so switches, mask icons, selected tiles and filled buttons survive Windows high contrast, and no state shown by color alone.

## 4. Popup (a 500 px wide window; must also fit 420 px)

Top to bottom. Ids, `data-*` hooks and texts stay as they are.

Scrolling: the real window is 500x680. Only the header and the action bar are pinned. Everything from the tools row to the end of the results sits in one scroller (`<main class="scroll">`), so the lot card scrolls away and the list gets the room. `#msg-bar` is sticky at the top of the scroller, so the last status line stays visible; `scroll-padding-top` keeps focused controls out from under it.

1. **Header** (52 px, `--surface`, bottom hairline). `.logo`: new mark (a rounded card outline in `--brand`, four corner brackets in `--ask-fill`), then "Card Scanner" in display 17 px/700, not uppercase. `#open-options`: 36x36 icon button with a gear SVG, `aria-label="Settings"`, `title="Settings"`.
2. **Action bar** (`.action-bar`, padding 12 16 8, grid `1fr auto auto`, gap 8). `#btn-scan`: primary, 44 high, radius 10, leading viewfinder icon, label in display 14 px/700 uppercase. Disabled: 45% opacity, not-allowed cursor. Scanning (`.scanning`): an amber line sweeps along the bottom edge of the button. `#btn-clear`: ghost button (1 px `--border-strong`). `#era-select`: 44 high, custom chevron, max-width 132. `#stat-value`: `display: none` (its figure is the lot card's; the element stays for scripts and tests).
3. **Tools row** (`.overlay-row`, padding 0 16 10, space-between). The checkbox becomes a switch by CSS only (36x20 track, 16 px knob, `--primary-bg` when on); its label markup is pinned by a test and must not change. `#btn-draw`: small ghost button (32 high) with a crosshair icon instead of an underlined link.
4. **Notices** (`#restore-note`, `#access-notice`, `#fullsize-notice`, `#exam-strip`): margin 0 12 8, padding 10 12, radius 10, 13 px text. Fill: restore `--surface-2`, access `--brand-tint`, full-size `--info-tint`, help-check `--ask-tint`. One small primary button for the main action, ghost for the rest, a text button for "Not now".
5. **Message bar** (`#msg-bar`): 13 px `--ink-2`, margin 0 16 8. `.error`: `--danger-tint` fill, `--danger` text, padding 8 12, radius 10.
6. **Lot card** (`#lot-totals`): margin 4 12 10, `--surface`, border, radius 14, shadow, padding 14 16 12, a 3 px `--foil` strip on its top edge. First `.lt-item` (confirmed value) takes the full width: label 12 px uppercase `--ink-3` on its own line; the `<b>` figure in display 28 px/700 tabular (24 px at 420 px wide; a range may wrap); `.lt-n` 12 px `--ink-3`; `.lt-cond` as a small chip. The other items (`.lt-guess`, `.lt-unconfirmed`, `.lt-skipped`) sit in one row under a hairline: label 12 px `--ink-3`, figure 14 px/700. `.lt-actions`: a full-width row of two equal ghost buttons, 36 high, with copy and download icons added by CSS (mask or background), so their text stays as rendered.
7. **Lot edition** (`#lot-edition`): one line, margin 0 16 8, 13 px label, 32 px select.
8. **Results** (`.results`): fills the rest, scrolls, padding 4 12 16, `--bg`, 8 px between slabs. Keep the four `zoom` media queries exactly as they are.

Result rows:
- **Group headers** (the "To confirm (N)" toggle, not recognised, removed/skipped, hidden): 13 px/700, chevron that turns with `aria-expanded`, 36 high. "To confirm" has an amber dot and `--ask` text; `.choose-review` is a small button on the right with a `--brand` border and text.
- **Slab** (`.card-row`): `--surface`, 1 px `--border`, radius 14, padding 12 12 12 16, `--shadow`. `.conf-stripe` is a 4 px rail on the left inside edge. Its color is the card's state, from the same function the page overlay uses (`overlayStateOf`, written to the row as `data-state`): identified `--ok`, printing open `--info`, choose `--ask`, not recognised `--ink-3`. The old confidence-tier classes (`high`, `medium`, `low`, `abstain`) stay in the markup but carry no color: a tier shown by color alone had no legend, and it disagreed with the overlay.
- **Head** (`.card-head`): thumb, text, price, with 12 px between them, aligned to the top. On confirmed rows the row itself is the grid and `.card-head` is `display: contents`, so the footer line ("Why this card?" left, "Wrong card?" right) shares the columns and the thumb spans both lines. New first cell on confirmed rows: `.row-thumb`, a button with `data-show-on-page` and `data-idx` holding the crop (`cropThumb(card)`), 44x62, radius 6, 1 px border, `title="Show this card on the page"`; left out when there is no crop. `.card-name`: display 15 px/700 `--ink`. `.card-sub`: 13 px `--ink-3`, flex-wrap with 4 px/6 px gaps. `.set-chip`: 12 px/700, `--surface-2`, border, radius 6, padding 0 5. `.card-number`: `--ink-2`, tabular.
- **Price** (`.card-price`): right-aligned, tabular. A single confirmed price: 16 px/700 `--ink`. A range: 14 px/700 `--ink-2`, may wrap after the dash. Unconfirmed, "no price", "…" and "—": 13 px/600 `--ink-3`. Add modifier classes in `renderPrice` / `renderUnconfirmedPrice` to tell these apart (`is-quote`, `is-range`, `is-soft`); the text and `title` stay the same.
- **Row actions**: `.link-btn` ("Wrong card?", "Why this card?", "Search for this card", "Draw a box", "None of these? Search", "Close") become quiet text buttons: 13 px/600 `--brand`, no underline until hover, min-height 28, padding 4 6. `.remove-btn`: 28x28 icon button top right, `--ink-3`, `--danger` on hover.
- **Chips** (`.value-chip`, `.memory-chip`, `.small-chip`, `.photo-chip`, `.lt-cond`): 12 px/600, radius 6, padding 2 8, `white-space: nowrap`. Value chip `--ask-tint`/`--ask`; memory chip `--brand-tint`/`--brand`; the others `--surface-2`/`--ink-2` with a border.
- **Pick printing strip** (`.strip`, tiles, `.chip-suggested`): everything in the blue family, to match the overlay. Label 12 px/700 uppercase `--info`. Tiles 92 px wide, `--surface-2`, radius 10, art radius 6, name 12 px/600, number 12 px `--ink-3`. Suggested or selected tile: 2 px `--info-fill` ring, `--info-tint` fill, "Suggested" tag in `--info`; the selected one also carries a check mark. Printing and card names wrap and are never cut with an ellipsis: the cut part is what tells two printings apart.
- **Set and variant choices** (`.set-select-row`, `.variant-select-row`, role radio): chips 32 high, radius 10, border; checked: `--primary-bg` fill, `--primary-fg` text.
- **Graded grid** (`.graded-grid`): 3 columns of small tiles, label 12 px `--ink-3`, price 13 px/700 tabular.
- **Why popover** (`.why-pop`): inset panel, `--surface-2`, radius 10, 13 px.
- **Choose row** (`.choose-row.asking`): the owner approved this interaction; restyle only. Slab with the amber rail and a 1 px border mixed from `--ask-fill`. Head: "Card N" 13 px/600 `--ink-3`, the sub line with chips, the unconfirmed price in the soft style. `.picker-title`: display 16 px/700. `.picker-sub`: 12 px `--ink-3`. `.pick-row`: a grid; the crop is the first column and spans the candidate rows, so it stays beside every candidate (three candidates per row at 500 px, two at 420 px). `.scanned-card`: 100 px wide crop with four amber viewfinder brackets drawn in CSS around it and the label "On the page" 12 px/600 `--ask` under it; a hairline separates it from the candidates. Candidate tiles (`.pick-card`): 88 px minimum (about 93 px at 500 px), `--surface-2`, radius 10, art radius 6, name 12 px/600, set and number 12 px `--ink-3`. The preselected best tile: 2 px `--brand` ring, `--brand-tint` fill, `.pick-best` tag "Best match" (`--brand` fill, white text in light; `--brand` fill, `--primary-fg` text in dark). `.pick-agree`: 12 px `--ok`. `.choose-actions`: `.choose-confirm` primary, 40 high, grows, ellipsis; the search button ghost, 40 high; `.skip-btn` a text button.
- **Search panel** (`.picker-bar`): input 40 high, radius 10, `--surface-2`, search icon inside; "Close" text button. Results use the candidate tile.
- **Compact rows** (not recognised, skipped, removed, hidden): one-line slabs, thumb 34x48, 13 px `--ink-2` label, actions on the right as text buttons.
- **Empty state** (`#empty-hint`): centered column; a 96 px inline SVG (dashed card outline inside amber viewfinder brackets); the existing sentence in 14 px `--ink-2`, max-width 280.

Review dialog (`#bulk-panel`): a sheet over the popup with a 50% ink backdrop; `--surface`, radius 14, max-height 90%. Header: title in display 18 px, close as a 32x32 icon button. Intro and hint 13 px `--ink-2`. Pairs (`.bulk-pair`): two 64 px images side by side, text 13 px, a 20 px checkbox (`accent-color: var(--brand)`); `.skipped` pairs at 55% opacity. Sticky footer: "Cancel" ghost, `#bulk-confirm` primary, both 40 high.

Setup wizard (`#setup-overlay`): covers the window with `--bg`. Centered column, max-width 400, gap 16. A 56 px logo mark. A row of three step dots above the title (`.wiz-dots`, static markup per step, `aria-hidden="true"`; the current step's dot is `--ink`, the others `--border`). Title in display 22 px/700; description 14 px `--ink-2`, line-height 1.5. Primary button 44 high, full width; "later / skip" as a text button under it. `#setup-status` 13 px `--ink-2`. Progress bars: label 12 px, 6 px track `--surface-2`, fill `--foil`, percent tabular.

## 5. Options page

One column, max-width 720, centered, `--bg`. Header: logo mark and the existing `h1`. Each section is a card (`--surface`, border, radius 14, padding 20, 16 px apart): title display 16 px/700, description 14 px `--ink-2` capped at 62 characters per line, then its controls. Checkboxes become switches by CSS where the markup allows it without changing pinned markup. Inputs 40 high, radius 10, `--surface-2` (the key field keeps a monospace font). Buttons use the shared styles: one primary per card at most, ghost for the rest, `--danger` text for destructive ones ("Clear", "Delete all", "Disconnect"). Status lines 13 px in the matching state color. Footer: the affiliation line, 12 px `--ink-3`.

## 6. What must not change

- Every element id, every `data-*` attribute and value (including `data-via="wrong-card"` and `"search"`), the classes scripts and tests select (`card-row`, `choose-row`, `asking`, `card-price`, `card-name`, `picker-title`, `picker-sub`, `pick-best`, `pick-agree`, `pick-choice`, `scanned-card`, `guess-mark`, `set-select-row`, `chip-suggested`, `lt-item`, `lt-guess`, `lt-n`, `lt-skipped`, `choose-toggle`, `choose-review`, `bulk-pair`, `bulk-keep`, `bulk-check`, `bulk-img`, `value-chip`, `skipped-row`, `unrec-name`, `hidden`, `active`, `error`, `scanning`, `flash`, `skipped`, `no-art`, `picker-input`, `picker-results`, `strip-art`, `strip-more`, `variant-select-row`, `conf-stripe`).
- All visible wording and all `aria-*` and `role` attributes. `#lot-totals` keeps `aria-live="polite"` and `aria-atomic="true"`. `#setup-size` keeps its text.
- The overlay-toggle label markup in `popup.html` and the look-alike toggle markup in `options.html` (tests pin them character for character).
- The `dev-only:start` / `dev-only:end` blocks, and no dev-only word (`testSetCollection`, `__cardScanner`, `127.0.0.1`, `localhost:`, `dev-only`) in any new file.
- No new permission, host, remote font or remote image. No "Accept all" control. Choices stay pictures, never name dropdowns. No price is shown as confirmed before the user confirms the card.
- `manifest.json`, `background.js`, `content.js`, `lib/` logic, `scripts/`.

## 7. Round 2 (owner request, 2026-11-14): bigger cards, scaling, less text

The owner asked for three things: hovering a card makes it larger and easier to see, the window scales when it is enlarged, and less text on screen. Inspiration they named: dextcg.com, pkmn.gg, cardelyx.com (set page), Dribbble "pokemon card ui". What those share: the card art is the hero, text is short, and Cardelyx gives the user a card-size slider. The principle for this round: **show the card, not words about the card.**

### 7.1 Hover preview ("loupe")
- Hovering any card picture in the popup (row thumbnail, "On the page" crop, candidate tile, printing tile, compact-row thumbnail, review-dialog image) opens a large preview after 150 ms. Moving to another picture switches at once; leaving closes it after 80 ms; Escape, scrolling or the window losing focus closes it. Keyboard: a picture button that gets `:focus-visible` opens it too; blur closes it.
- **Compare view.** When the hovered picture is a candidate or a printing and its row has a page crop, the preview shows two cards side by side at the same height: "On the page" (the crop) and the hovered card, each with a one-line caption (name, set, number, taken from the tile's own text). This is the comparison the user is making. Hovering the crop alone shows the crop alone.
- Size: the largest that fits: height `min(70vh, 460px)`, and for two panels also `(viewport width - 48) / 2 / 0.716`. At 500 px wide that is about 315 px tall, 2.3 times the tile.
- Placement: beside the hovered picture when there is room, otherwise centered horizontally above or below it; always inside the window; `pointer-events: none` so it never steals the hover.
- Sharpness: the crop is 375 px wide, enough. Candidate pictures from `https://images.pokemontcg.io/<set>/<n>.png` load the `_hires.png` version (same host, 734 px) behind the small one, swapping in when loaded and keeping the small one on error. Any other URL is used as is. No new host.
- Motion: fade and scale from .96 in 140 ms; none under reduced motion. The preview is decorative (`aria-hidden`): every fact in it is already in the tile.
- Code: `tools/extension-wasm/lib/loupe.js` with pure `placeLoupe(...)` and `hiresUrl(...)` (unit-tested) and a small DOM controller; one static `#loupe` element in `popup.html`.

### 7.2 Hover motion on tiles
Picture tiles lift 2 px with a deeper shadow on hover (180 ms), and a single foil sheen (a soft diagonal light band) sweeps across the art once (600 ms; faster reads as a flash). None under reduced motion.

### 7.3 Card size
A card-size slider (small card icon, range, large card icon; `aria-label="Card size"`) in the header scales every picture tile and thumbnail: factor 0.8 to 1.6, default 1, saved in `chrome.storage.local` (`cardSize`). Hidden below 440 px window width. At the default, row thumbnails are 64x89 (were 44x62) and candidate tiles about 112 px wide.

### 7.4 Scaling with the window
The four `zoom` rules are removed. The layout adapts instead:
- Under 720 px: one column, as now.
- 720 px and up: the header and action bar stay full width; below them a left panel (340 px, sticky, scrolls on its own if long) holds the lot card, notices, lot edition and help-check strip; the results list fills the rest.
- 1100 px and up: confirmed rows sit in a grid of columns (min 380 px each); choose rows in a grid of columns (min 560 px each); groups and their headers span the full width.
- Picture sizes grow with the window: at 500 px a candidate tile is about 145 px (two across beside the crop; the slider's small end gives three), at 1440 px about 160 px and at 1920 px about 190 px, times the card-size factor.
- In the two-pane layout the lot counts are a short label/figure list, and Copy and Download are full buttons with text at the bottom of the lot card; the toast sits at the bottom of the left panel so it never covers the list. Type grows a little: the lot figure `clamp(28px, 2.4vw, 40px)`, card names `clamp(15px, 1.1vw, 18px)`.
- Markup: one wrapper `<div class="side">` around the left-panel elements inside `main.scroll`; under 720 px it is `display: contents`.

### 7.5 Less text
- **Tools row removed.** "Show boxes on page" becomes an eye icon toggle in the header (the checkbox itself, drawn as a 36 px icon button; the label markup a test pins stays exactly, text visually hidden, `title` added). "Draw a box" becomes a crosshair icon button in the header with a `title`.
- **Status line becomes a toast.** `#msg-bar` moves to a toast at the bottom of the window: messages fade out after 5 s; errors stay until the next message. The long scan summary ("Found 9 cards: ...") therefore no longer sits above the lot card, whose counts say the same. The list gets bottom padding so the toast never covers the last row, and `scroll-padding-bottom` keeps focused controls clear of it.
- **Lot card.** Copy and Download become icon buttons in the card's top-right corner (text visually hidden under 900 px window width, shown above it; accessible names unchanged). The counts sit on one line with dot separators.
- **Confirmed rows.** No footer line. "Why this card?", "Wrong card?" and Remove become three 28 px icon buttons (info, swap, close) in a cluster under the price; their names come from their existing text and labels, and each has a `title` tooltip. The set-id chip (`base1`) is hidden: the set name is already shown and the id is not what is printed on the card.
- **Choose rows.** "Choose the right card" and "Closest matches, best one first" are visually hidden (kept for screen readers); "Which card is this?" says it once.
- **Empty state.** One sentence: "Open a page with Pokémon cards, then press Scan Page."
- Kept on purpose: the "High value, double-check" chip, "Set not sure", "Pick printing", "Best match", "On the page", the "Confirm <name>" and "None of these? Search" buttons, notices (they only appear when needed), and every accessible name.

## 8. Round 3 (owner request, 2026-11-15): the page overlay

The owner's screenshot of a 3x3 binder page shows the problem: every card carries a two-line dark tag ("Team Rocket's Moltres ex? / Tap to choose") across its top, right over the card's printed name and art, which is what the user needs to see to check a match. The owner asked for the same design system on the overlay, a small price as the resting overlay, and the name on hover. Principle: **the card stays visible; the overlay says only the price until asked.** This section overrides the "`content.js` must not change" line of section 6 for the overlay drawing only.

### 8.1 Resting state: a price chip and corner brackets
- **Frame.** The full outline becomes viewfinder corner brackets, the same mark as the popup's "On the page" crop: four L-shaped arms in the state color, arm length `min(18px, 22% of the shorter side)`, 3 px over a 5 px dark under-stroke (`rgba(0,0,0,.55)`) so they show on light and dark photos. A 1 px outline at 35% opacity in the state color keeps the box's extent readable where boxes are close together. Card back / not recognised: grey brackets, dashed outline. Skipped: grey brackets only.
- **Price chip.** One small chip per card, inside the card's bottom-right corner, 4 px from both edges. The bottom right is the least informative area of a card (rarity and illustrator text); the name, art and the bottom-left number stay clear. The chip is 22 px tall, radius 6, a dark slab (`rgba(25,23,41,.94)`, the dark `--surface`) with a 3 px state rail on its left edge, text 13 px weight 700, tabular figures, in the dark-scheme state text color (`--ok #3DD9A0`, `--info #7FB0FF`, `--ask #FBBF24`, `--ink-2 #C3C1D9` for none). What it says:
  - Identified: the price, `$3.49`. No price yet or an old price: `—`.
  - Printing to pick: the range with one dollar sign, `$0.60–2.01`; if that does not fit, `from $0.60`. "Set not sure" moves to the hover card.
  - Choose: the best match's price marked unconfirmed, `? ~$0.74` (the `?` drawn in the state color). No best-match price: `?` alone. Never a bare unmarked figure (owner rule: no price shown as confirmed before the user confirms).
  - High value (`display.highValue`): a `!` drawn before the text, `! $120.00`, so the double-check flag survives without words.
  - Not recognised or too small: `?` alone, grey. Skipped: no chip.
- **Small cards.** The chip shows only if it fits inside the card's visible width minus 8 px; if not, a 10 px state-colored dot sits in the same corner. Nothing is drawn as a cut-off number (the existing never-cut-a-price rule).
- **Placement ladder.** Inside bottom-right first; then inside top-right; then just below the card, then just above it; never on another chip; never over a site bar above the photo (the existing clip rules). The two-line form and the neighbour top-band rules for the old tag go.
- **Click.** A Choose or printing chip stays clickable and opens the pick in the scanner, as the tag did. Its hit area is padded to at least 28 px tall.

### 8.2 Hover: the name card
- Hovering a card (or the popup pointing at it) shows its name card and a full 2 px outline in the state color with a soft glow of the same color (blur 10). The chip and brackets stay.
- **Where.** Just outside the card, never over its top half: above the card's top edge, left-aligned with it, when that fits inside the photo's visible rect; else just below the bottom edge; else inside the card at the bottom. It may be wider than the card and stays inside the visible photo and the viewport, as now.
- **Look.** Dark slab `rgba(25,23,41,.96)`, radius 10, 1 px border `rgba(255,255,255,.08)`, shadow `0 6px 18px rgba(0,0,0,.45)`, a 3 px state rail on the left. Line 1: the name, 15 px weight 650, `#EFEEF8`, display font stack `"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif` (no web fonts in the content script: they would need a web-accessible resource, which the store build pins), with ` #number` after it in `#C3C1D9`. Line 2: the price or the action, as the label says today, in the state text color (17 px for a price, 13 px for an action).
- **Text.** The label's current words stay (the guess name with `?`, "Tap to pick it in the scanner", "High value, double-check. Tap to pick it in the scanner", "Set not sure · $0.60–$2.01", "Old price", "Not recognised" / "Turn it over to identify it", "Too small", "Skipped" ...). Only where they are drawn changes.
- **Remove X.** Stays on the hovered card's top-right corner, drawn last, restyled to the slab colors (dark fill, 1.5 px `rgba(255,255,255,.85)` ring, white ×).
- Motion: none on the canvas (it redraws on every scroll); the name card simply appears.

### 8.3 Other overlay pieces
- "Open full-size photo for better results ↗": fill `#5B3FE6` (`--brand`), radius 10, 28 px tall, white 13 px weight 700 text. Wording unchanged.
- The popup's "show this card" highlight keeps its fill and outline, recolored to `--brand` `#5B3FE6`.
- `STATE_COLORS` stay the same values (they equal the popup's `*-fill` tokens).

### 8.5 Click a card on the page to open it in the scanner (owner, 2026-11-15)
The owner asked: clicking the card on the listing, while it is highlighted, opens the extension at that card. This overrides 8.4's "only clicks inside drawn chips" for the hovered card.
- **What is clickable.** The hovered card's whole visible box (the one with the full outline and the name card), plus its name card and chip, in every state: identified, printing, choose, none. Cards not hovered stay click-through as now; with a mouse a card is always hovered before it is clicked, so in practice clicking any highlighted card works. The X keeps winning its own click (remove).
- **The page's own click.** A taken click is stopped (`preventDefault` and `stopPropagation` in the existing capture-phase handler), so the site does not also open its photo viewer. A click with Ctrl, Shift, Alt or Meta held, or any button but the primary, passes through to the page untouched, and so does every click while the overlay is hidden. Only trusted clicks count (as now).
- **Opening the scanner.** The content script sends one message with the card's index. The background handles it: it focuses the scanner window if one is open, or opens it the same way the toolbar button does (one shared function, not a copy), with the page's tab as the scan target. The background then passes the index to the popup. If the popup was just opened, it reads the pending index once its lot is restored; a stored pending index older than about 10 s is ignored.
- **In the popup.** The card's row scrolls into view (center, smooth unless reduced motion) and flashes as now. On wide windows the dock shows that card's page picture. Focus goes to the row's first useful control: the Best match tile for a Choose card, the Confirm button for a card reopened by Change, otherwise its Change button. A card in a collapsed group (Skipped, Not recognised) opens its group first. The page keeps the popup's highlight on that card (the existing `highlightOnPage`).
- **Tests.** Content: a trusted primary click on a hovered identified card sends the message and is stopped; a click with Ctrl passes through; a click while hidden passes through; the X still removes. Background: the message focuses an open scanner window or opens one, and the popup receives the index; a stale pending index is ignored. Popup (Playwright): the message for an identified card scrolls, flashes and focuses its Change; for a Choose card, its Best match tile; a skipped card's group opens.

### 8.4 What must not change on the overlay
Click handling (`isTrusted` only, capture-phase, only inside drawn chips, X and pill), `overlayPick`, `overlayRemove` and its wait for the stored removal, the hidden-overlay toggle, the visible-photo clipping, the gallery rules, `cardState`, `labelText` wording, `guessLine`, `fitPrice`, the never-cut-a-price and name-stub rules where they still apply, and the canvas staying `pointer-events: none`. No new permission, host, web-accessible resource or font file.

## 9. Round 3, popup side: the pricing journey and the final pricing screen (owner request, 2026-11-15)

The owner priced a real 3x3 binder page to the end and sent a screenshot of the popup at full width (2505 px) with everything confirmed. What it shows:
- **Rows look different from each other.** Four confirmed rows (Tatsugiri, Moltres #208, Mega Zygarde, Leafeon) have no page picture and are tall, mostly empty boxes; the three rows the user confirmed from Choose have a picture. Cause: `background.js` (~1282) attaches the page crop only to unsure cards, so an auto-identified card reaches the popup without `crop`.
- **The compare preview has nothing to compare.** Hovering a printing tile in the Iron Hands row shows only the catalog card, because the row has no crop.
- **Overflow and cramped names.** The grid runs past the right edge (Mega Zygarde's price is cut), and names wrap to three lines in rows whose picture takes the width.
- **No clear end point.** After the last confirm there is no "this is your priced lot" moment, and the way back from a wrong match is an unlabeled swap icon.

The owner's direction: keep the structure the same at every window size; after confirmation show a final pricing screen that lists each confirmed card with its price; offer a way back to pick the right card for a mismatch; use and refine the same design system.

### 9.1 The journey (what the user sees, step by step)
1. **Scan.** On a listing the user presses Scan Page. The page shows corner brackets and price chips (section 8). The popup shows the lot card and, first, "To confirm (n)".
2. **Confirm.** Each Choose row: "On the page" crop, candidate tiles, "Confirm <name>", "None of these? Search" (owner-approved, unchanged). Hovering a candidate shows the crop and the candidate side by side (7.1). A confirm moves the card into the priced list below; the page chip turns green.
3. **Pick printing.** A card whose printing is open stays in "To confirm" style until picked: it shows its range and its printing tiles, and its crop beside them.
4. **Priced lot (the final pricing screen).** When nothing is left to confirm or pick, the popup is the final pricing screen: the lot card with the confirmed total, then "Priced (n)", the list of every confirmed card with its price, then the collapsed Skipped / Not recognised groups. Copy and Download export exactly that list.
5. **Fix a mismatch.** Every priced row has a visible "Change" button. It reopens that card's choice in place: the Choose layout (crop beside candidates, best match preselected), or, when the card has no candidates, "None of these? Search" opened with the card's crop beside the results. Confirming the new card replaces the row and updates the total. Escape or "Cancel" leaves the card as it was.

### 9.2 One row structure everywhere
- Every card row, at every width, has the same four parts in the same order: **picture** (the page crop, 64x89 at the default card size, times the card-size factor), **text** (name, then set name and `#number`, then a printing chip when there is one), **price** (right-aligned, tabular, the state's text color), **actions** (Change; Why this card? and Remove as icon buttons with tooltips).
- The picture is always there. Every card that reaches the popup carries its crop, identified or not. If storage size forces it, an identified card's crop may be stored at thumbnail size (the popup already shrinks crops with `smallCrop`); measure the stored lot size for a 9-card and a 60-card lot before and after and report it.
- Rows never stretch to a neighbor's height: in the wide grid, rows align to the top and keep their own height. A row with printing tiles is a To-confirm-style row, not a tall priced row.
- Names wrap to at most two lines, then cut with an ellipsis; the full name is in the `title` and the accessible name. The picture never squeezes the text column below 160 px: under that, the row's printing tiles move below the row's text.
- No horizontal overflow at any width from 360 to 2560 px: grid columns use `minmax(min(100%, 380px), 1fr)`.

### 9.3 The final pricing screen
- **Group header** "Priced (n)" over the confirmed rows, styled like "To confirm (n)" with the `--ok` color, shown whenever there are priced cards.
- **Done moment.** When "To confirm" reaches 0 for the first time in a scan, the lot card shows a short line under the figure, "All cards priced", with a check icon in `--ok`. Nothing animates beyond the existing outline flash; it is not a dialog.
- **Priced rows** follow 9.2. Price text: the confirmed price; a still-open range never appears here (that card is in To confirm). The "High value, double-check" chip stays on a high-value card until the user confirms it.
- **Change** is a visible text button ("Change", 32 px, ghost style) on every priced row; its accessible name is "Change <name>, pick the right card". "Wrong card?" text and its swap icon become this one button; its `data-open-search data-via="wrong-card"` hook stays if that is what opens the choice, so existing tests keep their selector.
- **Order.** Priced rows keep scan order (the order of the cards on the page, row by row), so the list reads like the binder page.
- Wide windows: the left panel keeps the lot card; the priced list is the main column, in a grid of 380 px+ columns.

### 9.5 The compare dock: the same place every time (owner, 2026-11-15)
The owner liked the hover preview of the candidate but wants the page picture shown in the empty left panel under the lot card (circled on their screenshot), and the preview to appear in the same place every time instead of following the hovered tile.
- **Two-pane layout (720 px and up).** The left panel gets a sticky compare dock under the lot card (and under any notices): the "On the page" crop of the card being compared, as large as the panel allows (panel width minus padding, height capped so it fits the window below the lot card), with a one-line caption, "On the page · <name or Card n>", in the `--ask` label style.
- **Hover or focus any picture tile in a row** (candidate, printing tile, row thumbnail, compact-row thumbnail): the dock shows that row's crop at once (no delay), and the preview shows the hovered card alone (one panel), **always at the same spot**: directly right of the left panel, its top aligned with the dock image's top, the same height as the dock image. The two cards sit side by side at the same height and in the same place for every tile. Hovering a crop itself shows it in the dock and opens no preview.
- **Leaving.** The preview closes as now; the dock keeps the last crop (no flicker while moving between tiles) until another row's tile is hovered or focused. A new scan or Clear empties and hides it.
- **Narrow layout (under 720 px).** No dock. The preview keeps two panels (crop and candidate) but at a fixed spot too: centered horizontally, at the top of the window when the pointer is in the lower half, otherwise at the bottom. It never follows the tile.
- **Code.** `lib/loupe.js` gets a docked placement (the host passes the anchor: the dock image's rect and the left panel's right edge) beside the existing float placement, both pure and unit-tested; the refresh, focus, Escape and scroll rules stay. The dock is decorative (`aria-hidden`); every fact is in the row.

### 9.8 High value: double-check with a Confirm check (owner, 2026-11-15)
The owner: clicking a high-value card opens its row, but not what the system matched it to, and there is no confirm check. Today a $50+ card the scanner confirmed itself carries "High value, double-check" until `userConfirmed` (`lib/stakes.js` `isHighValue`). But a priced row offers no way to set it, and since 9.3's fix a Change pick of the same card is a Cancel, so the flag can never be cleared.
- **The row.** A flagged row shows the comparison inline: the "On the page" crop with its brackets beside the **matched card** (the catalog picture of the card the scanner chose, with name, set and `#number` under it, labelled "Matched"). It looks like a Choose row with one candidate, at the same tile sizes. Under them, two buttons: **Confirm** (primary, check icon, accessible name "Confirm <name>, it matches") and **Change** (ghost). The price and the chip stay in the head.
- **Confirm.** It sets `userConfirmed` on the card. The chip goes, the page chip loses its `!` mark, and the row collapses to a normal priced row (the 9.7 look). It is saved exactly as confirming the best match in a Choose row is saved (same message and fields; no new correction kind), so the corrections memory gets a positive example. Change stays available afterwards.
- **Totals and end state.** The card counts in Confirmed value before and after (no change to totals). "All cards priced" waits until no flag is left. Until then the lot card says "1 to double-check" (or n) in the `--ask` color, in place of the done line.
- **From the page.** Clicking a flagged card on the page (8.5) opens its row with focus on Confirm.
- **Matched picture source.** Use the card's own catalog image if the card carries one. Otherwise derive the URL the candidate tiles already use (`https://images.pokemontcg.io/<set>/<n>.png`, no new host). If neither exists, the row shows the crop alone with Confirm and Change.
- **Hover anywhere.** Hovering a priced row's thumbnail (any confirmed card, flagged or not) previews the crop beside the matched card (the dock plus one panel on wide windows, two panels on narrow), so "what did it match this to" is one hover away on every row.

## 10. One interaction model: hover previews, click acts (owner request, 2026-11-15)

The owner asked for a review of how clicking and mouseover work across the whole extension, revamped for simplicity and the user journey. A read-only audit (2026-11-15) listed every hover, click and focus interaction. The problems it found, worst first:
- Page targets give no cursor or hover feedback, and an identified chip looks clickable but did nothing.
- Single clicks commit with no on-the-spot undo.
- The "On the page" crop sits in the candidate strip, looks like a candidate tile, and only navigates.
- Page↔popup linking works one way: page hover tells the popup nothing.
- Some previews are mouse-only.
- Hover styles are missing on some targets.
- The two "Open full-size photo" controls behave differently.
- A plain click in draw mode silently cancels.

### 10.1 The rules (apply everywhere)
1. **Hover (or keyboard focus) previews; it never changes data.** Previews are the highlight, the name card, the dock and the loupe.
2. **Click acts.** Every clickable thing shows it on hover: a pointer cursor and a visible change. Nothing that looks clickable is inert.
3. **One meaning per kind of thing.**
   - **A card picture of the user's own card** (the page box, the "On the page" crop, a row thumbnail, a dock picture) means "this card". Clicking it takes you to the same card on the other side: page → popup row; popup picture → page box.
   - **A catalog picture** (candidate, printing, search result) means "this is the right one". Clicking it chooses it.
   - The two kinds look different. Own-card pictures always carry the viewfinder brackets. Catalog pictures are tiles with a frame and show a check mark on hover.
4. **Linked both ways, instantly.** Hovering a card anywhere highlights the same card everywhere. On the page: the highlight outline. In the popup: a soft `--brand-tint` ring on its row, and on wide windows the dock shows its crop. The popup never scrolls on hover, only on click.
5. **Every commit can be taken back on the spot.** After a pick, a skip or a removal, the toast says what happened and offers the way back as a button in the toast:
   - pick → "Change", which opens the row's Change;
   - skip or remove (in the popup or with the page X) → "Put back", the existing put-back.
   The toast with an action stays 8 s and does not fade while hovered or focused. No new undo of saved corrections: Change is the correction path.
6. **One timing.** Linked highlights and the dock react at once (0 ms). The loupe opens after 150 ms and closes 80 ms after leaving, as now. The page name card follows the page hover at once. These are the only delays.
7. **Keyboard reaches every preview.** Anything that previews on hover also previews on `:focus-visible`. The page canvas has no keyboard path: the popup is the keyboard surface, and its rows link to the page on focus (already the case).

### 10.2 Changes per surface
- **Page overlay (`content.js`).**
  - The cursor is a pointer while over a hovered card's box, chip, name card, X or the pill, set on the page root only while hovering and restored after.
  - Every card is clickable (8.5). The X shows a hover ring.
  - Page hover sends the hovered index (or none) to the popup, only when it changes (rule 4).
  - The full-size pill does exactly what the popup's "Open full-size photo" does, through the same background path: site permission, then a new tab, then an auto-scan.
- **Draw mode.**
  - A click without a drag no longer cancels: it keeps draw mode, and the hint bar says "Drag a box around the card."
  - The hint bar gets a "Cancel" button, and Esc still cancels.
  - The header crosshair is a toggle: pressed while drawing, and pressing it again cancels.
- **Choose rows.**
  - The "On the page" crop keeps its brackets, gets the own-card hover style (the brackets brighten) and stays a "show on page" button.
  - Candidate tiles show a check mark badge on hover and focus (catalog style).
  - The Best match tile and "Confirm <name>" stay (owner-approved); they do the same thing.
- **Printing tiles.** A page click on a card with an open printing focuses its first printing tile, not Change.
- **Rows.** The soft linked ring appears when the same card is hovered on the page. `.unrec-thumb` becomes a focusable own-card button (show on page) with the same hover style.
- **Review dialog.** Keyboard focus on a pair's checkbox previews that pair (the loupe), as hover on its images does.
- **Toasts.** A commit's toast carries its action button (rule 5). The existing remove toast text that says where Put back is gets replaced by the button.

### 10.3 Not changing
- One-tap confirm on a candidate (owner-approved).
- The radiogroup keyboard pattern on printing strips (arrows move, Enter or Space picks). Picking saves a correction, so an arrow must not commit.
- The corrections pipeline.
- The difference between the version swap (no correction) and the set pick (correction). Reported as an owner question, not changed.

## 11. Journey fixes, top to bottom (owner request, 2026-11-15)

The owner asked for the whole journey to be checked, not just the overlay click. A UX walk-through of every screen (2026-11-15, 22 findings) found the weak points below. Decisions:
- Adopted: marked by step.
- Not adopted: listed at the end with the reason.
- Wording: one name per idea. "Version" (the printing, set or edition question), "unconfirmed" (any price not confirmed by the user), "skip" (leave a card out). The words "guess", "variant", "finish" and "edition" are not used in visible text, except the Base Set edition names themselves (Unlimited, Shadowless, 1st Edition). Tests that pin old wording change deliberately.

### 11.1 Before the first scan
- **Setup wizard.**
  - Step 1 says "One-time download (about 150 MB). After that, everything runs on your computer. No account needed." Its only button is "Download". While it runs: "Downloading 2 of 3 · 42%", "Keep this window open", and Retry on failure.
  - Steps 2 (site access) and 3 (price key) carry an "Optional" tag and a visible "Skip".
  - Step 3 drops the grade and condition abbreviations from the screen; they stay in the options page.
  - Plain wording on the access step: "Read the original, sharper photos on Marketplace? It finds more cards." with Allow / Not now. "Without your cookies" moves to the tooltip.
- **Disabled Scan Page.** When it cannot run, a line under the empty mark says why. "Open a listing on Facebook Marketplace, Mercari or another site, then press Scan Page" when the tab is not a page it can read, or "Finish setup first" before the models are ready.

### 11.2 Scanning
- While scanning, the empty-state text is replaced by a line that stays: "Looking for cards…", then "Reading 6 cards…" once boxes are found. The fading toast is not the only status.
- The scan summary toast is short: "Found 9 cards · 4 need you." The long breakdown moves to the "To confirm" tooltip.
- **Notices** (site access, full-size photo, restored lot): one at a time, access first. Wording:
  - "Some cards are small. Open the full-size photo to read them better." [Open photo]
  - "Let Card Scanner read the original photos on example.com? It finds more cards." [Allow] [Not now]
  - "Restored your last scan (12 min ago)." [Scan again]
- **Errors** name the action: "Reload Card Scanner at chrome://extensions, then press Scan Page."
- **Scan button.** It reads "Scan again" once a lot is shown.

### 11.3 The page overlay
- **First-scan legend.** A small dismissible pill above the photo, shown once and remembered in `chrome.storage.local`: "Green: priced · Amber ?: pick the card · Blue: pick a version · Grey: not read. Hover a card for its name, click it to open it."
- **Chip.** A Choose card with no price says "Pick", not a bare `?`. A not-read card stays a grey `?`.
- **Hover name card.** For a printing-open card it says "Pick a version · $0.60–$12.01", not "Set not sure".

### 11.4 To confirm
- **Lot card numbers agree with the list.**
  - "To confirm" equals the "To confirm (n)" group count.
  - Cards with an open version are a separate line, "Versions to pick", equal to the "Pick printing" group count. That group is renamed "Pick a version (n)".
  - The figure says "· 3 cards" in place of the bare "(3)".
  - "Unconfirmed ~$145.00 (2 cards)" stays (owner rule, 2026-10-24: shown apart from Confirmed value) but is reworded "Unconfirmed · ~$145.00 · 2 cards", in `--ink-3` at normal weight, so it is never louder than the total.
- **"Can't price this" becomes "Skip this card".** The toast says "Skipped" and offers Put back (section 10).
- **No-match row.** "No close match. Search for it, or skip it." The search box is open by default with the crop beside it.
- **"Review all n"** counts exactly the cards it will show. "Review these n together" is the label.
- **Confirm button.** It never cuts the name: min width to fit, two lines allowed.
- **Toast and controls.** The toast closes when the user presses anything in the results list, and never sits over a Confirm button: at narrow widths it is placed above the bottom row of controls.

### 11.5 Versions and high value
- **Version strip.** Title "Which version is it?" in place of "Pick printing" and "SET?". Subline "Several versions. Pick yours for the exact price." in place of "Set not sure". After a pick, a one-line "Picked: Jungle" with the strip still there to change it.
- **Base Set edition dropdown** on the lot card: label "All Base Set cards are…". The tooltip loses the "Variant menu" reference.
- **High-value chip.** "High value · check the match". Section 9.8's Confirm and the image placeholder handle the rest.

### 11.6 Final screen, export, clear
- **Export buttons.** "Copy list (3)" and "Download CSV (3)". The copy toast says "Copied 3 cards · $14.50" and, when some are left out, "2 unconfirmed left out".
- **Clear** with a lot shown: the toast says "Cleared 9 cards" with Undo (8 s), which restores the lot exactly. No dialog.
- **Bottom groups.** One naming pattern and one chevron style, no dash: "Not read (n)" (card backs, too small, unread), "Not a card (n)" (the hidden group), "Left out (n)" (skipped and removed). Each row says its own reason: "Card back. Turn it over.", "Too small.", "Skipped.", "Removed."

### 11.7 Header and settings
- **Header.** The crosshair becomes "Add card" (icon plus text) wherever the header has room (560 px and up; at 440 px the label wrapped the title, 2026-11-15). The title "Card Scanner" never wraps. The lot card's "Skipped or removed" stat is "Left out", matching the bottom group. The size slider gets the tooltip "Picture size". The eye's tooltip is "Show or hide the boxes on the page".
- **Options page.**
  - Group it as "Prices", "Photos" and "Help improve Card Scanner", with everything else under a collapsed "Advanced".
  - Hide a setting that has no effect in this build, such as the disabled look-alike switch whose note says the list is not included.
  - Rename "Corrections" to "Remember my fixes".
  - Dev-only controls stay inside their `dev-only` blocks and never reach the store build.

### 11.8 Not adopted (and why)
- **The "~$120 · check" mark on a flagged confirmed card's price.** The owner's rule makes high value a chip, not a state, and the card counts as confirmed. Section 9.8's Confirm resolves it.
- **Removing "Review all".** The owner asked for the bulk "confirm all, review first" grid on 2026-10-22. Only the count and label are fixed. "Tick all" was an owner question; on 2026-11-15 the owner said "probably not? I want simplistic", so 12.5 removes it.
- **Merging "Not a card" into "Not read".** Hidden entries have their own "Show it" flow and are never saved with the lot, so they stay a separate group.
- **Renaming "Era".** Low value for the churn. Its tooltip already explains it.

## 12. Confirmed cards collapse to one line (owner request, 2026-11-15)

The owner's words: "Once a card is confirmed, can it be minimized? Like a hamburger style list? Then if clicked again it expand/ the detail? The minimized should just be the card photo, name, set, set number and value."

### 12.1 Which rows collapse
- A row collapses when it is **settled**: it is in the Priced group and nothing on it asks the user. A row is not settled while any of these holds:
  - its high-value check (9.8) is still waiting for Confirm;
  - it is being changed (`_changing`), or a search or picker is open on it;
  - its price is a range (a version still to pick);
  - its version was suggested from the picture and is not yet confirmed (the `?` mark);
  - its set is a guess not yet confirmed (the `bestGuess` `?` mark);
  - its name was found several times in the photo (`repeatedName`, the ⚠ "Check it" mark; found in the cold review, 2026-11-15).
- The rule is one pure function in `lib/card-display.js` that takes these facts as flags, so it can be tested without the popup.
- To confirm, Versions to pick, Not read, Left out and Not a card are unchanged.

### 12.2 The collapsed row
- One line, in this order:
  - **photo:** the catalog's stock image of the confirmed card (`thumbUrl(card.identity)`, the picture 9.8's "Matched" tile uses), not the page crop. The owner asked for this on 2026-11-15. It is about 40x56 at the default card size, scaled by the card-size factor. When there is no stock image URL, or the image fails to load, the page crop is shown instead, so the row always has a picture;
  - **name:** one line, cut with an ellipsis, with the full name in the `title`;
  - **set and number:** the set name and `#number` on one line, cut with an ellipsis;
  - **value:** the same price cell `renderPrice` draws today, with the same text, title and look;
  - a **chevron** at the right edge.
- Nothing else shows: no chips, no marks, no buttons.
- The photo keeps its section 10 job, a click shows the card on the page, and the hover loupe still works on it. The rest of the line is one `<button class="row-toggle" aria-expanded="false" aria-controls="…">` whose accessible name is "<name>, <set> #<number>, <price>. Show details".
- No nested buttons: the photo button and the toggle button are siblings.

### 12.3 Expand and collapse
- Clicking the toggle, or pressing Enter or Space on it, expands the row in place to today's full row. The head stays the same, the chevron turns up and `aria-expanded="true"`. Clicking the head's toggle again collapses it.
- Which rows are open is kept per card for the current lot, in `_expanded`. It is cleared by `resetLotUiState()` and never saved: a reopened lot shows its rows collapsed, like `_showNotCard`.
- **Confirming collapses.** When the user confirms a card (a Choose confirm, a pick, a version pick that settles it, or the high-value Confirm), the row collapses. Focus goes where it goes today: the next card to confirm, or else that row's toggle, never `body`. The existing "Picked … · Change" message is the way back.
- A row the user opened stays open through re-renders and through changes made inside it, such as a version swap.
- A click on that card's photo on the listing (8.5) expands its row and scrolls it into view. Hovering a card on the page only highlights the row (`.page-linked`), as today, and does not expand it.
- No height animation. The chevron turns over 150 ms, and not at all with `prefers-reduced-motion`.

### 12.4 Not adopted
- **"Expand all" or "Collapse all" in the Priced heading.** Kept out for simplicity. Ask the owner if long lots need it.

### 12.5 Owner decisions, 2026-11-15
- **"Tick all" goes from the review dialog.** Only the button and its label go. Pairs still come pre-ticked when they look like clear matches. A hand tick still works. The rule that a tick the user did not make saves no correction stays.
- **`tests/e2e/scan-smoke.spec.js` is removed, with its page `public/scan-test.html`.** It waited for `window.updateResults`, which the extension never defined, and nothing else uses either file.
- **A version swap to a definite card saves a correction like a set pick**, with via "candidates".
- **The scanner window's `rescanResult`, `drawnCard`/`drawnFailed` and `scanProgress` listeners accept only the background.**

### 9.7 Reference look (owner, 2026-11-15)
The owner called the in-progress narrow popup "one of my favorite layouts. Simplistic, easy to understand" (`.tmp/reference/owner-favorite-2026-11-15.png`, about 500 px wide). It shows:
- The Choose layout reopened by Change: the crop with brackets and "On the page", two candidate tiles with "Best match", then "Confirm Eevee", "None of these? Search" and "Cancel" in one line.
- Below it "PRICED (2)" in `--ok`, with rows of picture, name, set and `#number`, the price at the top right, and at the bottom right the info icon, a "Change" ghost button and ×.
- Then "1 card not recognised — Show".
Keep this look: one clear row shape, few words, the picture first. Wider layouts are this same structure in more columns plus the dock (9.5), not a different design. The owner's other screenshots from this round are in `.tmp/reference/`.

### 9.6 What must not change
Everything in section 6 except where 9 says otherwise, the Choose row layout (owner-approved), the two states CONFIRMED and CHOOSE, no "Accept all", choices as pictures, the unconfirmed price marking, the lot totals' rules (only confirmed cards count in Confirmed value), the export format, and the store build's permission and host list.
