// Opens the scanner window, or focuses the one that is open. The toolbar button and a click on a card on the page share it.
// Calls run one after another: the window's id is known only once windows.create resolves, so a second call made in
// the meantime must find that window, not open another.

// Keep the popup narrow and tall so it docks on the right without obscuring the page content.
const WINDOW_OPTIONS = { type: "popup", width: 500, height: 680, focused: true };

export function createScannerOpener({ windows, getContexts, popupUrl, setTargetTab, isInternalUrl, getWinId, setWinId }) {
  async function focusOpen() {
    // After a service-worker restart the id is null even if the window still exists: find it.
    if (getWinId() !== null) {
      try { await windows.update(getWinId(), { focused: true }); return true; } catch { setWinId(null); }
    }
    const [existing] = await getContexts({ contextTypes: ["TAB"], documentUrls: [popupUrl] });
    if (existing?.windowId != null && existing.windowId >= 0) {
      setWinId(existing.windowId);
      try { await windows.update(existing.windowId, { focused: true }); return true; } catch { setWinId(null); }
    }
    return false;
  }

  async function run(targetTab, beforeCreate, onCreateFailed) {
    // Nothing is injected here: the page is touched only when the user presses Scan.
    if (targetTab && !isInternalUrl(targetTab.url)) setTargetTab(targetTab.id);
    if (await focusOpen()) return false;
    // Only a call that will open a window gets here: a focus-only call never runs the hook. Its failure must not stop the window.
    try { await beforeCreate?.(); } catch { /* the window still opens */ }
    let win;
    try {
      win = await windows.create({ url: popupUrl, ...WINDOW_OPTIONS });
    } catch (err) {
      // What the hook stored is for a window that does not exist.
      try { await onCreateFailed?.(); } catch { /* the create error is the one to report */ }
      throw err;
    }
    setWinId(win.id);
    return true;
  }

  let chain = Promise.resolve();
  return {
    /**
     * Resolves true when this call opened a new window, false when it focused one. `beforeCreate` runs once, just before
     * windows.create, and only when this call opens the window; `onCreateFailed` runs once if that create rejects.
     */
    open(targetTab, beforeCreate, onCreateFailed) {
      const result = chain.then(() => run(targetTab, beforeCreate, onCreateFailed));
      chain = result.catch(() => {});
      return result;
    },
  };
}
