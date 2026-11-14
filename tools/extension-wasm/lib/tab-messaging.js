// content.js is not declared in the manifest. It is injected when a page needs it, so every
// message to a page has to survive the page not having the script yet.

const NO_RECEIVER = /could not establish connection|receiving end does not exist/i;

/**
 * A screenshot taken with the overlay drawn is read as tags, not cards, so the overlay is hidden for the capture, and
 * only for it: it shows again as soon as the capture is taken or fails. Its boxes follow their photos, so they stay
 * right until the scan's result replaces them; a long rescan must not blank them.
 */
export async function captureWithoutOverlay(api, tabId, capture) {
  await sendToTab(api, tabId, { action: "hideOverlay" }).catch(() => {});
  try {
    return await capture();
  } finally {
    await sendToTab(api, tabId, { action: "restoreOverlay" }).catch(() => {});
  }
}

/** Send to the page; if nothing is listening, inject content.js and send once more. */
export async function sendToTab(api, tabId, message) {
  try {
    return await api.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (!NO_RECEIVER.test(String(err?.message || err))) throw err;
  }
  await api.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  return api.tabs.sendMessage(tabId, message);
}
