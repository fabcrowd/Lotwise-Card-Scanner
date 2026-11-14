# Handoff: Fable 5.2 pass on hardening detection and identification (written 2026-11-12)

Run this pass as the main Claude Code session on Claude Fable 5.2:

    claude --model claude-fable-5-2

## How to run it on Fable 5.2
- **Effort:** use `high` for the session. Use `xhigh` only for one hard, long piece of work where it measurably helps. Don't use `max`.
- **Your role:** you take the "Opus" role in CLAUDE.md's working model. You plan, brief, review, verify and commit when the owner asks. Code and file changes go to `builder` subagents with `model: sonnet`. Every change gets a cold `adversary` review before you call it done.
- **Delegation:** subagents cost tokens. Start one for a bounded edit, a test run or a parallel labelling job, not for reading a file you can read yourself.
- **Ownership:** the owner owns this code and wants surgical changes. Fix what is in scope. Report nearby problems rather than refactoring them. Review the diff, not only the builder's summary.
- **Finish the work:** don't stop at ordinary obstacles such as a timeout, a flaky Playwright port (EADDRINUSE: run the specs one at a time) or a busy file. Diagnose them and carry on. Stop only for the deliberate blockers listed below or for an owner decision.

## Steps that need no approval
- Running `npm test`, `npm run lint`, `node --test tests/store-build.test.js`, the dist rebuild (`scripts/build-wasm-extension.ps1`, and `-Store` / `-Sealed`) and Playwright specs.
- Running offline Python scripts in card-scanner-data at below-normal priority with ≤8 threads.
- Running the realworld harness with an explicit dev pages file.
- Retrying reads, builds and tests.

## Hard rules (deliberate blockers: leave them alone and report)
- Never read, list or search `data/sealed-test`. Run `node scripts/sealed-score.mjs` only when the owner asks.
- Never tune to viewed sets: the 30 local photos, fresh-20261111 and `data/realworld/fresh-pages.json`.
- Any model, threshold or check change follows the same steps:
  1. Write a preregistration before any data is labelled, with the criteria fixed in advance.
  2. Score once.
  3. Ship only if every criterion passes.
- `lib/fusion.js` thresholds must be refit on labelled non-sealed data whenever the model, the crop or the catalog changes.
- Learning features stay off until a score shows a gain.
- No new permission or host without a deliberate `tests/store-build.test.js` change. Dev-only code must stay out of the store package.
- Commit only when the owner asks, and stage specific files (never `git add -A`). Pushes need the owner.
- Never commit marketplace photos, labels or secrets: the card-scanner-data repo is public, and it also has uncommitted owner work.
- Don't kill all `chrome.exe`. No bot-check workarounds when harvesting.

## Read first
1. CLAUDE.md.
2. `tasks/lessons.md`.
3. HANDOFF.md, together with `docs/handoff-2026-10-24.md`.
4. card-scanner-data `tasks/handoff.md`.
5. `data/reports/check-20261112/README.md` (in card-scanner-data).

## Current state (branch `feat/price-follows-pick`, pushed 2026-11-13 up to `ce4d39e`)
The branch is now pushed up to `ce4d39e` ("feat: share drawn, removed and put-back boxes from opted-in users", 26 files). The branch `feat/price-follows-pick` was merged into `main` by pull request #2 (https://github.com/fabcrowd/pokemon-auto-lister/pull/2, merge commit `1efb2f3`) on 2026-11-14.

Recent commits:
- ce4d39e: feat: share drawn, removed and put-back boxes from opted-in users.
- c00fd90: docs: add file map, delegation rule and the Fable hardening handoff.
- 125173e: draw a box around a card the scan missed.
- 6bf7146: remove a card with an X.
- f811fdf: say "removed" in the status line and the export note.
- 5bd7beb: a drawn box matches the right entry after scrolling and stays in its own tab.
- 64c5127: drawn boxes are kept as local training examples (dev build only; export from Settings → "Drawn boxes for training").
- 41cc5fa: the non-linear "is this a card" check (check.bin v2), with a "check is live" test.

Gates at `c00fd90`: `npm test` ran 1,669 tests, 1,668 pass, 0 fail, 1 skipped; lint clean.

Gates at 41cc5fa:
- `npm test`: 1,668 pass, 0 fail, 1 skipped.
- lint: clean.
- store-build: 8/8.
- `check-live` spec passes.
- E2E draw-box and overlay-remove: 3/3 each (measured at 64c5127).

Not yet tried by hand in a real browser.

## Hardening targets (in order)
1. **"Is this a card" check.** The 2026-11-12 refit stopped before scoring, because the test split had 25 agreed non-card boxes and 40 were needed. The packaged check rejects only about half of non-cards on fresh-20261111, and coins still pass. The next attempt needs a new preregistration:
   - use all of check-20261112 (still blind) as extra fit data;
   - make a new harvest aimed at coin, tin and sealed lots for the test set;
   - size the harvest from this yield: about 112 agreed non-card boxes per 92 boxed listings.
   - **Second attempt, 2026-11-12: stopped at its pre-harvest gate.** On the 112 agreed check-20261112 non-card boxes, the refit rejects 51.8% out of fold versus 66.1% for the packaged check, which is -14.3 points against a bar of +15. No harvest was run, no box was labelled and nothing was shipped. The linear-on-embedding recipe is the limit, and the report is at `card-scanner-data/data/reports/check-20261112b/README.md`. The next attempt is an owner decision between a non-linear check (new check format plus a small extension and pipeline change), a 98.5% real-kept target, or detector hard negatives.
   - **Third attempt (2026-11-12, owner chose the non-linear option):** preregistered in `card-scanner-data/data/reports/check-20261112c/PREREGISTRATION.md`. A 514 -> 128 -> 1 check on the embedding plus detector score and box aspect, new file format `check.bin` v2. Frozen once (sha256 `781e7ff4...b876`); pre-harvest gate passed (+14.3 points non-card rejection out of fold, real cards kept 97.67% vs 97.45%). Blind test harvest `harvest-20261112b` started; score once after two blind labellers. No extension code is written unless the score passes T1-T4; the list of what shipping then needs (v2 parser, score and aspect at the call site, keep the box on a non-finite input, input parity in the built extension, a "check is live" test, the live bundle's check status) is in that preregistration under "If it passes". Step list: `card-scanner-data/tasks/handoff.md`.
   - **Third attempt result (2026-11-13):** NO SHIP, scored once. On 360 real and 346 non-card blind test boxes the non-linear check rejects 69.1% of non-card boxes versus 50.9% for the packaged check (+18.2 points, lower bound +10.3) but keeps 97.78% of real boxes versus 98.61% (-0.83 points; the preregistered margin was -0.5), so T1 failed. T2, T3, T4 passed. The packaged check stays and the extension is unchanged. Report: `card-scanner-data/data/reports/check-20261112c/README.md`. Next step is an owner decision between stopping, a fourth preregistered attempt on a new blind harvest, or moving to target 2.
   - **Fourth attempt (2026-11-13, owner chose a fourth attempt):** preregistered in `card-scanner-data/data/reports/check-20261113/PREREGISTRATION.md`. Same non-linear recipe, fit data plus the harvest-20261112b labels, threshold set leave-one-harvest-out to match the packaged check's hidden real count. Scored once on 1,259 real and 319 non-card blind boxes: real kept 98.17% vs 97.22% packaged, non-card rejected 83.07% vs 63.64% (+19.4 points, lower bound +13.0). T1-T4 all pass. A cold review holds with caveats (the real-kept edge is Craigslist only; elsewhere it is a tie). The original input-parity ship gate failed on 2026-11-13: 17 of 121 matched boxes were outside the 0.02 / 0.01 tolerances (hide decisions agreed on 120 of 121). The owner chose an amended gate (`AMENDMENT-20261113-parity.md`), which passed on 60 new photos (181 of 185 matched, decisions agree on 151 of 153, mean score shift -0.0008). The change was applied in this working tree before commit 41cc5fa (`npm test` 1,668 pass / 0 fail / 1 skipped, lint clean, store-build 8 of 8, `check-live` spec passes). Smokes: 30 photos clean, screenshot path clean, tiled path smoked on one composed photo (7 of 1,047 tiny real-card boxes hidden). A cold review holds with caveats. The live bundle carries no check. Committed as `41cc5fa` in `auto card lister`, pushed 2026-11-13; next steps are owner decisions: release, and detector misses (target 2), which waits for exported drawn boxes (none exist yet). Report: `card-scanner-data/data/reports/check-20261113/README.md`.
2. **Detector misses.** Use exported drawn boxes (kinds missed / tooSmall / hidden) as a list of what the detector misses. Recall under about 100 px is the weak band. Any detector retrain follows the gates in `docs/blurry-training-plan.md` and `detector-upgrade-handoff.md`, and its gate counts sure-wrong on Facebook-style photos, not just top-1. The owner has no export yet: drawn boxes are stored only by the developer build, only on that computer (up to 200), and are never uploaded; the store build leaves the feature out. So this target waits for the owner to draw and export boxes, or for an owner decision to build a consented upload for other users.
3. **Corner model A/B.** It is blocked until the owner uploads `card_corners.onnx`.
4. **Sure-wrong names.** The owner accepted roughly +3–5 sure-wrong names for about +45 right names (HANDOFF.md). Any identification change must not raise sure-wrong beyond that. Price never decides confirmation, and there is no "Accept all".
5. **Printing-level identification.** Printing stays the user's pick under glare. Keep "pick printing" for open printings.

## Self-improving loop (owner goal, 2026-11-13)
The owner wants the system to improve for every user from normal use, for names and for detection.
- **Already built (names):** opt-in sharing of picks and fixes, the relay, the nightly job and the signed bundle (`docs/plans/shared-learning.md`). It has no contributors: sharing is off by default and the store listing is not submitted.
- **Tested and not adopted:** sending the scanner's own sure answers with no click. Preregistered offline gate failed on 2026-11-13 (+0.74 points in right names, under the +1.0 bar and not shown to exceed training noise; under the nightly rule that a memory answer is never sure, memory rows lowered the number of confirmed cards; independent review holds with caveats). Report: `card-scanner-data/data/reports/selflearn-20261113/README.md`.
- **Built and committed 2026-11-13 (`ce4d39e`), deployed 2026-11-14:** opted-in users share three new "box signal" rows under the same toggle. `drawn` is a box the user drew, sent when it is placed and again with the card if the user picks one. `removed` is the X; it does not mean "not a card". `put-back` is the undo of a removal. Each row carries a small crop, the box position, and `detector: {score, aspect, kind}`, where kind is `found`, `missed`, `hidden` or `tooSmall`. Only teach-split photos are shared, there is one row per contribution, nothing new is sent on exam photos, and a skip sends nothing. Existing pick, wrong-card and confirm rows are unchanged.
  - Code: `tools/extension-wasm/lib/contribution.js`, `lib/share-rows.js` (`signalRow`, `boxSignalSource`, `contributeSignal`), `lib/draw-box.js` (`replacedKind`), `background.js` (`contributeBoxSignal`, message `shareBoxSignal`) and `popup.js`; the relay template `tools/relay/src/validate.js`; the nightly job template `tools/shared-data/pipeline/contributions.py` and `run.py`. The contract and rollout order are in `docs/plans/shared-learning.md`.
  - The nightly job accepts and counts these rows (`boxSignals` in the run summary) and strips them before anything else, so the pack and manifest are byte-identical with and without them. Nothing trains on them yet: using them to retrain the "is this a card" check or the names needs its own preregistered study, after data exists.
  - Rollout order the owner must follow: update the nightly job in `card-scanner-data` (its `pipeline/` copy is older than this template and differs in `gate.py` and `catalog.py`), then deploy the relay, then load or ship an extension build that sends the rows. An older relay answers a new row with a 4xx and the extension drops that whole batch of up to 20 contributions.
  - Privacy: a removed or drawn box sends whatever is inside it, and contributions are public and permanent. `docs/store/privacy-policy.md`, `docs/store/listing.md` and the toggle text in `options.html` were redrafted to say so, and to cover three older gaps (retraining on shared crops, pictures becoming public, and a card back on an exam photo being sent as "not a card"). The policy text is a draft for the owner to approve.
  - Gates on the working tree: `npm test` 1,713 tests, 1,712 pass, 0 fail, 1 skipped; lint clean; shared-data Python suite 206 tests OK; a cold review holds with caveats. Known gaps left open: there is no browser-level test of the popup sending these messages; the relay and nightly job do not refuse a box signal row on an exam-split photo (the extension never sends one and the nightly job strips them); a second box drawn over a drawn too-small box is reported as kind `tooSmall`; a drawn card restored from a saved session keeps only a thumbnail, so its later signals are not sent; "Show it" on a hidden box is not shared yet and is the obvious next signal.
  - The detector itself cannot learn from crops; a detector fix ships in a release.
  - Deploy state (2026-11-14):
    - Nightly job: the update was pushed to the data repo's `main` as `5268adb` (the same five files; 250 tests OK, 5 skipped, before the push). GitHub accepted it by bypassing a branch protection rule on `main` with the owner's admin rights.
    - Relay: deployed from `tools/relay` at `main`'s source as Cloudflare version `862687d4-61d4-4d72-b473-9177afa8aff9`, replacing the version from 2026-10-17. Besides the new validator it also ships the 2026-10-24 fix that stores `received` as a day. A smoke check sent one deliberately invalid box signal row and got HTTP 400 with the new detector message, so the new validator is live and nothing was stored. The relay lives on a second Cloudflare account, not the first one the CLI signs in to. `npx wrangler deployments status` in `tools/relay` must show the Worker (created 2026-10-17) before any deploy. If it says the Worker does not exist, the sign-in is the wrong account: do not deploy.
    - With the merge, the nightly job and the relay all in place, a build from `ce4d39e` or later can have the sharing toggle on. No contribution with a box signal row has been sent yet; the first real one is the remaining end-to-end check.

## Live bundle adapter check (2026-11-13, diagnostic)
The live bundle's adapter is byte-identical to the local seed adapter. On the 2,583 name-agreed boxes, the plain catalog gets 1,987 right, 562 sure-right and 10 sure-wrong. With the live adapter it gets 1,977 right, 619 sure-right and 20 sure-wrong (right names -0.39 points, 95% interval [-1.46, 0.70]; 94 wrong to right, 104 right to wrong). On fresh-20261111 (780 boxes), plain is 576 / 185 / 10 and the adapter is 566 / 200 / 14 (-1.28 points, interval [-3.22, 0.59]).

The live manifest is seq 29, issued 2026-11-13T11:11:30Z, with exam n 0, an empty memory pack and no check asset.

This is a diagnostic and decides nothing. The adapter's trade (more sure-wrong for no gain in right names) is worse than the trade the owner accepted in HANDOFF.md. Whether to keep, retrain or pull the adapter is an owner decision, and any change needs its own preregistered test. Report: `card-scanner-data/data/reports/adapter-check-20261113/README.md`.

Decision 2026-11-13 (the owner delegated it to the session): keep the live adapter for now. The reasons: the check was a diagnostic on boxes that had already been viewed, so under this repo's rules it cannot justify a model change; the interval on right names includes zero; and today only the owner's developer build reads the bundle. Before the store submission, run a preregistered keep-versus-pull test on the next blind names harvest, with sure-wrong as a deciding criterion.

## Release and store readiness (2026-11-13)
- There is no release channel for the extension itself; only the owner's unpacked developer build exists. GitHub releases on `fabcrowd/pokemon-auto-lister` are model assets (v3.0 was published 2026-10-23). `check.bin` v2 from `41cc5fa` reaches users only inside an extension build.
- The store package builds with `scripts/build-wasm-extension.ps1 -Store` into `dist/extension-wasm-store.zip` (version 3.1.0; permissions activeTab, scripting, storage; 8 hosts; optional `<all_urls>`). Rebuild it after any source change before uploading.
- Real-scan screenshots (1280x800) are in `.tmp/store-screenshots/real/` (`01-page-overlay-and-popup.png`, `02-choose-printing.png`, `03-settings-shared-learning.png`) with the scripts that made them. They come from the developer build scanning the repo's demo page (`public/scan-test.html`), because the store build has no permission for a local address; the popup and overlay look the same. Things to check before using them: all card art is third-party; every card landed in "pick printing", so prices show as wide ranges; the lower rows of the popup are cut off at the bottom; the site-access prompt is not shown. The earlier mocked candidates are still in `.tmp/store-screenshots/`.
- Owner-only steps: the developer account and the $5 fee; the dashboard forms; the privacy policy URL now serves the redrafted text; the policy URL is now chosen (see `docs/store/listing.md`), and the policy text was reviewed for accuracy against the code and is committed, but the owner can still change it; a manual test of the zip; adding the store-assigned extension id to the relay's allow-list; the relay moderation decision; the price snapshot 404; the pins.json v3.0 bundle rebuild; and revoking the Cloudflare setup token and the GitHub fine-grained token that were pasted into a chat on 2026-10-17.

## Still owner decisions
The pins.json v3.0 bundle rebuild; committing the card-scanner-data check files; the `card_corners.onnx` upload; the set-stamp `finishSure`; the privacy policy; relay moderation; the price snapshot 404; store submission.

## Reporting
Write final reports for a reader who hasn't seen your tool calls. Put the result first, in plain full sentences. Give the commands you ran and their results as evidence.
