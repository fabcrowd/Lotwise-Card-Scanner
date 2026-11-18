# Known limits and open decisions (owner's page)

One line each. "Where" says where to look or change it.

## Limits of the product
- **Japanese cards are asked about only at 200 px and taller; smaller ones and other languages can still be priced as English.** A card 200 px or taller that looks Japanese becomes a question with Japanese matches (25,531 cards, prices from TCGplayer via tcgcsv.com). On the final test 5 of 258 English boxes were flagged (read it as a few percent at most) and 8 of 12 Japanese boxes were caught (roughly 40% to 90%). In the harvests 101 of 174 Japanese boxes are under 150 px, so most Japanese cards in lot photos are still missed. The exact card is among the four Japanese matches for about 6 in 10 flagged cards; the rest need the search box. Korean, Chinese and other languages have no catalog. Japanese sets are not updated nightly: rebuild `catalog-ja.bin.gz` by hand. The cut-offs (margin 0.005, 200 px) are fitted to this recognizer, crop and catalog. Where: `card-scanner-data/data/reports/japanese-20261117/README.md` and `ADDENDUM.md`; `tools/extension-wasm/lib/japanese.js`; older background in `card-scanner-data/data/reports/foreign/README.md`.
- **Newest English sets depend on the nightly job running with the current recognizer.** Until the owner pushes the updated `tools/shared-data` template to the data repo and rebuilds `regression.npz`, cards released after the shipped catalog (for example `me06`, `30th`) are not recognized. Some older cards have no usable picture at either source and stay missing (most trainer kits, some promos, Celebrations Classic Collection, the 2017 and 2018 McDonald's sets). Where: `tools/shared-data/README.md` step 10; `card-scanner-data/data/reports/newsets-20261117/README.md`.
- **Slabs and sealed product are not detected.** A slab shows the raw card price. Where: `docs/team-goals.md` G10; release notes Limits.
- **Cards missing from the catalog false-confirm.** 5-8% of absent cards (16-29% of those with an unseen name) in a synthetic test; price does not decide confirmation; unconfirmed cards worth $50+ only carry a "High value, double-check" chip. Where: `card-scanner-data/data/reports/fusion-study-E/floor/README.md` s3(a), s5; `tools/extension-wasm/lib/fusion.js`, `lib/stakes.js`.
- Stamped printings (Prerelease, Staff, Pokemon Center, event stamps, most set-logo stamps) are priced as the regular card until the stamp work in `tasks/todo.md` lands.
- **Cheap-card promotion looks at the top guess only.** A $100 card read as a $0.30 look-alike is confirmed cheap. Where: `lib/stakes.js:37`.
- **High-tier confirm cut-offs (0.82 / 0.025) were fitted on an older model.** Not refit for the v3 recognizer. Where: `lib/fusion.js`, `tools/shared-data/pins.json` `highTier`.
- **Popup state is lost when the popup closes.** Unconfirmed picks, printing choices and skips are not saved; skipped cards return as "Choose" on rescan. Where: `popup.js` (in-memory `_lastResult`), `docs/team-goals.md` G5.
- **Stacked cards** may be read as one card and confirmed. Where: release notes Limits.
- **eBay and OfferUp accuracy is unmeasured** (downloads blocked); no eBay larger-photo rule. Where: release notes Limits.
- **Corrections memory cut-offs were set and checked on the same 666 pictures**, and a mistaken click is remembered. Where: `lib/reference-bars.js`, `card-scanner-data/data/reports/g12/measurements.md`. "Use my corrections" is on by default (`background.js` `useReferences !== false`).

## Evidence gaps
- **No untouched score.** The Facebook and marketplace sets were used to choose the model and confirm rows; the sealed set has not been scored for this release (`node scripts/sealed-score.mjs`, only when you ask). Where: release notes Measured.
- **Release-build figures are stale.** Facebook and marketplace confirm numbers come from an earlier build; cross-source numbers use the earlier confirm rule. Rerun on the release commit. Where: `.tmp/gate2/score4-tables.md`, `card-scanner-data/data/reports/cross-source`.
- **Real-Chrome check outstanding.** The Facebook full-size photo path has only been tested with a stand-in. Where: `docs/publish-v3.0.md` ("Real Chrome check on your PC").

## Privacy and store submission
- **Privacy-policy URL is a placeholder (TODO-OWNER).** Host `docs/store/privacy-policy.md` at a public https URL, paste it into `docs/store/listing.md`, and link it from the options page. The store requires it.
- **The relay is public and unmoderated.** Anyone who can forge an Origin header can post JPEGs into a public, permanent GitHub repository; there is no review or takedown process beyond emailing a sharing id. Shared crops come from third-party sellers' listing photos. Decision: private inbox branch or a review gate. Where: `tools/relay/src/handler.js`, `validate.js`; policy "Shared learning".
- **Relay token and branch protection are unverified.** Confirm `main` protection and the `pack-signing` environment on `fabcrowd/card-scanner-data`.
- **Price snapshot is unsigned** (the learning pack is signed). Where: `lib/price-snapshot.js`.
- **Build and publish steps not done:** release v3.0 asset upload, `pins.json` update in the data repo, and a rebuild with `-Store` at the release commit. Where: `docs/publish-v3.0.md`.
