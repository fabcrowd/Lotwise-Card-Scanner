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

## Current state (branch `feat/price-follows-pick`, unpushed)
Recent commits:
- 125173e: draw a box around a card the scan missed.
- 6bf7146: remove a card with an X.
- f811fdf: say "removed" in the status line and the export note.
- 5bd7beb: a drawn box matches the right entry after scrolling and stays in its own tab.
- 64c5127: drawn boxes are kept as local training examples (dev build only; export from Settings → "Drawn boxes for training").
- 41cc5fa: the non-linear "is this a card" check (check.bin v2), with a "check is live" test.

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
   - **Fourth attempt (2026-11-13, owner chose a fourth attempt):** preregistered in `card-scanner-data/data/reports/check-20261113/PREREGISTRATION.md`. Same non-linear recipe, fit data plus the harvest-20261112b labels, threshold set leave-one-harvest-out to match the packaged check's hidden real count. Scored once on 1,259 real and 319 non-card blind boxes: real kept 98.17% vs 97.22% packaged, non-card rejected 83.07% vs 63.64% (+19.4 points, lower bound +13.0). T1-T4 all pass. A cold review holds with caveats (the real-kept edge is Craigslist only; elsewhere it is a tie). The original input-parity ship gate failed on 2026-11-13: 17 of 121 matched boxes were outside the 0.02 / 0.01 tolerances (hide decisions agreed on 120 of 121). The owner chose an amended gate (`AMENDMENT-20261113-parity.md`), which passed on 60 new photos (181 of 185 matched, decisions agree on 151 of 153, mean score shift -0.0008). The change was applied in this working tree before commit 41cc5fa (`npm test` 1,668 pass / 0 fail / 1 skipped, lint clean, store-build 8 of 8, `check-live` spec passes). Smokes: 30 photos clean, screenshot path clean, tiled path smoked on one composed photo (7 of 1,047 tiny real-card boxes hidden). A cold review holds with caveats. The live bundle carries no check. Committed as `41cc5fa` in `auto card lister`, not pushed; next steps are owner decisions: push or release, and detector misses (target 2), which waits for exported drawn boxes (none exist yet). Report: `card-scanner-data/data/reports/check-20261113/README.md`.
2. **Detector misses.** Use exported drawn boxes (kinds missed / tooSmall / hidden) as a list of what the detector misses. Recall under about 100 px is the weak band. Any detector retrain follows the gates in `docs/blurry-training-plan.md` and `detector-upgrade-handoff.md`, and its gate counts sure-wrong on Facebook-style photos, not just top-1. The owner has no export yet: drawn boxes are stored only by the developer build, only on that computer (up to 200), and are never uploaded; the store build leaves the feature out. So this target waits for the owner to draw and export boxes, or for an owner decision to build a consented upload for other users.
3. **Corner model A/B.** It is blocked until the owner uploads `card_corners.onnx`.
4. **Sure-wrong names.** The owner accepted roughly +3–5 sure-wrong names for about +45 right names (HANDOFF.md). Any identification change must not raise sure-wrong beyond that. Price never decides confirmation, and there is no "Accept all".
5. **Printing-level identification.** Printing stays the user's pick under glare. Keep "pick printing" for open printings.

## Self-improving loop (owner goal, 2026-11-13)
The owner wants the system to improve for every user from normal use, for names and for detection.
- **Already built (names):** opt-in sharing of picks and fixes, the relay, the nightly job and the signed bundle (`docs/plans/shared-learning.md`). It has no contributors: sharing is off by default and the store listing is not submitted.
- **Tested and not adopted:** sending the scanner's own sure answers with no click. Preregistered offline gate failed on 2026-11-13 (+0.74 points in right names, under the +1.0 bar and not shown to exceed training noise; under the nightly rule that a memory answer is never sure, memory rows lowered the number of confirmed cards; independent review holds with caveats). Report: `card-scanner-data/data/reports/selflearn-20261113/README.md`.
- **Proposed, not built, owner has not decided:** share drawn boxes and X-removed boxes as crops from opted-in users (new contribution rows; relay, nightly job and privacy text change), and let the nightly job retrain the "is this a card" check behind a preregistered gate. The detector itself cannot learn from crops; a detector fix ships in a release.

## Still owner decisions
Push and PR; the pins.json v3.0 bundle rebuild; committing the card-scanner-data check files; the `card_corners.onnx` upload; the set-stamp `finishSure`; the privacy policy; relay moderation; the price snapshot 404; store submission.

## Reporting
Write final reports for a reader who hasn't seen your tool calls. Put the result first, in plain full sentences. Give the commands you ran and their results as evidence.
