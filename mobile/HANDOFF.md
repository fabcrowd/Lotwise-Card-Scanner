# Handoff: mobile (the Lotwise phone app)

This file covers the phone app in `mobile/` only. The Chrome extension, the Windows installer and the nightly job are in the desktop handoff, [`../HANDOFF.md`](../HANDOFF.md). Read both before work that touches `tools/extension-wasm/lib`, because the phone app imports those files in place.

## Current state (2026-11-18)

The phone app is committed and unchanged since 2026-11-16 (commit `05b8496` on branch `feat/mobile-app`, pushed). It has never run on a phone, an emulator or a simulator.

No work was done in `mobile/` on 2026-11-17. That day's work was all desktop: Japanese cards in the extension, new-card rows in the nightly job, and the Windows installer. It changed five extension files the phone app imports, so the phone app's checks were rerun on 2026-11-18 on the tree that holds that work:

- `npx tsc --noEmit` in `mobile/`: exit 0, no output.
- `npx jest` in `mobile/`: 6 suites passed, 60 tests passed.

Not rerun: `npx expo export` (both bundles last built on 2026-11-15) and `npx expo lint`.

## What the app is

- An Expo SDK 58 app in TypeScript with Expo Router. Screens: Scan, Review, Library, Card detail and Settings (`mobile/app/`).
- It imports the extension's modules in place through one typed bridge, `src/core/ext.ts` (19 modules of `tools/extension-wasm/lib`). Nothing is copied, so this branch must stay in the same repository as the extension.
- `src/platform/` supplies what Chrome provided: a pixel canvas, storage, gzip and the ONNX runtime. `src/device/` holds the camera photo, files and the engine. `src/core/recognize.ts` restates the extension's recognition sequence, because that sequence lives in the extension's service worker and cannot be imported.
- On the phone a picture never confirms a card. Every card waits for the user's tap, and a price is fetched only after it. The extension's confirm thresholds (`lib/fusion.js`) were fitted to Chrome's image handling and are not measured on phone photos.
- Model files come read-only from this repository's GitHub releases and are kept only after their SHA-256 matches the pin in the extension's `lib/setup.js`.
- The library stays on the device. The optional price-service key is stored in the device keychain.
- Left out of recognition on the phone, because the phone has no data for them yet: the era filter, saved corrections, the community pack, and the 1st Edition and set-symbol reads.
- The plan this follows is `docs/plans/mobile-app.md` (phases in section 6, open owner decisions in section 8).

## What the desktop work of 2026-11-17 means for the phone app

Five of the imported files changed: `card-display.js`, `card-picker.js`, `condition-pricing.js`, `lot-export.js` and `setup.js`. Typecheck and tests still pass. The effects, most important first:

1. **Open fault: the phone now downloads a file it never uses.** The Japanese card list `catalog-ja.bin.gz` (9,046,332 bytes) was added to `OPTIONAL_ASSETS` in `lib/setup.js`. The phone app downloads every file in that list (`downloadOptionalModels` in `src/core/assets.ts`) and shows each one as a row under "Card models" in Settings (`src/ui/ModelsSection.tsx`). Nothing in the phone app reads the Japanese list. Before 2026-11-17 the list held only `ocr_det.onnx`, `ocr_rec.onnx` and `card_corners.onnx`. A second consequence: if only the Japanese file fails to download, Settings says "Some optional text files could not be downloaded, so text reading stays off", which would be untrue. Not fixed, because the fix is a decision: either the phone app filters the list down to the files it uses, or Japanese cards are supported on the phone (item 2).
2. **No Japanese cards on the phone.** `src/core/recognize.ts` does not call `lib/japanese.js`, and `lib/ja-prices.js` is not imported. A Japanese card gets English candidates like any other card and waits for a tap; the search does not find Japanese cards; there is no Japanese price. The phone never produces a `jp-` card id, so the new "raw, Japanese, <condition>" export text cannot appear there.
3. **No newest sets on the phone.** The phone does not read the nightly bundle. It only checks that the bundle's address answers (`checkDataSources` in `src/core/assets.ts`, shown under Sources in Settings). Cards released after the shipped catalog (for example `me06` and `30th`) stay unknown on the phone, also after the desktop side starts shipping them.
4. **No effect:** the Windows installer, the `tcgcsv.com` host permission and release `v3.2` are desktop matters. The phone's required downloads (`ASSETS`) did not change.

## Branch and files

- Branch `feat/mobile-app` holds both the phone app and the desktop work. The desktop commits of 2026-11-17 (`f65d08e`, `d1d8515`, `f372612`, `bfcdb31`, `7b72f41`, `d648247`) are local and not pushed; pushing waits for the owner to ask for it.
- `mobile/.claude/` and `mobile/.cursor/` are untracked folders written by session hooks on 2026-11-15 (a settings file and an unfilled session note). They are not part of any commit. The owner may want them in `.gitignore`.
- This file and the edit that makes `../HANDOFF.md` the desktop handoff were written on 2026-11-18 and are not committed.

## Open work, in order

1. Run the app once on a device or an emulator. It uses `onnxruntime-react-native`, a native module, so it needs a development build (`npx expo run:android`, `npx expo run:ios` or an EAS development build), not Expo Go.
2. Decide what the phone does with `catalog-ja.bin.gz` (effect 1 above), then have the change made and tested.
3. Before a picture may confirm a card on the phone, measure the confirm rule on labelled phone photos (plan phase 5). Until then the tap stays.
4. The remaining plan phases and the open owner decisions in `docs/plans/mobile-app.md`.

## Rules for work in `mobile/`

- Read `mobile/AGENTS.md` first. Expo changes with every SDK release: read the docs for the installed major version before touching an Expo, EAS or React Native API, and add packages with `npx expo install`.
- A change in `tools/extension-wasm/lib` can break the phone app or change what it downloads. After such a change run `npx tsc --noEmit` and `npx jest` in `mobile/`, and check `src/core/ext.ts` and `src/core/assets.ts` for the touched exports. The root `npm test` and `npm run lint` do not cover `mobile/`.
- Never create or edit `ios/` or `android/` by hand; they are generated.
- The root `CLAUDE.md` applies here too: the working model, the approvals (commit, push and merge wait for the owner to ask for that step), and the sealed test set.

## Commands

Run from `mobile/`:

```powershell
npx tsc --noEmit      # typecheck
npx jest              # unit tests
npx expo start        # dev server (needs a development build on the device)
npx expo export --platform ios --platform android   # build both bundles
```
