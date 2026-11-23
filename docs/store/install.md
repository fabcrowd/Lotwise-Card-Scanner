# Install Lotwise (Windows)

About three minutes. No account. Chrome only (not Edge/Firefox).

## Install

1. Download **[Lotwise-Setup-3.2.0.exe](https://github.com/fabcrowd/pokemon-auto-lister/releases/download/installer/Lotwise-Setup-3.2.0.exe)**.
2. Double-click it. If you see **Windows protected your PC**, click **More info**, then **Run anyway**. (The Setup file is not code-signed; that warning is expected when you got it from the release page.)
3. When the guide opens:
   1. Paste `chrome://extensions` into Chrome’s address bar.
   2. Turn **Developer mode** on (top right). Leave it on.
   3. Click **Load unpacked**, copy the folder path from the guide, paste it into the folder window’s address bar, press Enter, then **Select Folder**.
4. Pin Lotwise (puzzle-piece menu in the toolbar). Click the Lotwise icon → **Download models** (~147 MB, one time).
5. Optional — newest sets: open Settings → License, paste `LOTWISE-TRIAL`, click Activate. Core scanning works without a key; the trial key unlocks new sets while Lotwise is in preview (keys can be revoked).

Done. Open a page with card photos and click **Scan Page**.

## Update

Download and run the newer Setup from the same [installer release](https://github.com/fabcrowd/pokemon-auto-lister/releases/tag/installer). From 3.2.0 on, Lotwise reloads itself when it is safe, or shows **Restart now**. If you were on an older version, click the reload arrow once on Lotwise’s card on `chrome://extensions`.

## Remove

Windows Settings → Apps → Installed apps → remove **Lotwise card scanner**. Then on `chrome://extensions`, click **Remove** on Lotwise.

## If Setup will not start

Some PCs block PowerShell scripts; nothing is installed then. Load the extension by hand from a built folder instead: [`tools/extension-wasm/INSTALL.md`](../../tools/extension-wasm/INSTALL.md).

## Rebuild (developers)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1
```

Output: `dist/Lotwise-Setup-<version>.exe` and `dist/lotwise-version.json`.
