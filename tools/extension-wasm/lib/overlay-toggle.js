// "Show boxes on page": the popup's toggle for the page overlay. Hiding it keeps the scan's results.

export const OVERLAY_SHOWN_KEY = "overlayShown";

/** The stored choice; on unless the user turned it off (also when storage cannot be read). */
export async function loadOverlayShown(storage) {
  try {
    const stored = await storage.get(OVERLAY_SHOWN_KEY);
    return stored?.[OVERLAY_SHOWN_KEY] !== false;
  } catch {
    return true;
  }
}

export function saveOverlayShown(storage, shown) {
  return storage.set({ [OVERLAY_SHOWN_KEY]: shown === true });
}

/** The message the background sends the scanned tab for a relay request from the popup. */
export function tabMessageFor(msg) {
  if (msg.action === "relayOverlay") {
    return {
      action: "showOverlay", cards: msg.cards, srcWidth: msg.srcWidth, srcHeight: msg.srcHeight,
      ...(msg.fullSize ? { fullSize: msg.fullSize } : {}),
      ...(typeof msg.pageUrl === "string" && msg.pageUrl ? { pageUrl: msg.pageUrl } : {}),
      ...(typeof msg.scanId === "string" && msg.scanId ? { scanId: msg.scanId } : {}),
      ...(typeof msg.shown === "boolean" ? { shown: msg.shown } : {}),
    };
  }
  if (msg.action === "relayHighlight") return { action: "highlightCard", index: msg.index, scroll: msg.scroll };
  if (msg.action === "setOverlayShown") return { action: "setOverlayShown", shown: msg.shown === true };
  return { action: "clearOverlay" };
}
