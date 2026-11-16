// Hover preview ("loupe") for card pictures in the popup.
// Pure helpers (hiresUrl, loupeSize, placeLoupe, captionOf) plus a small DOM controller.

export const CAPTION_BAND_PX = 40;
export const CAPTION_MAX_CHARS = 80;
export const MIN_BESIDE_PANEL_W = 200;
export const LOUPE_PAD_PX = 12; // matches the padding in popup.css
const CARD_RATIO = 0.716;
const HIRES_RE = /^https:\/\/images\.pokemontcg\.io\/[^/?#]+\/[^/?#]+?(?<!_hires)\.png$/;

/**
 * Larger pokemontcg.io image URL; any other input is returned unchanged (null for non-strings).
 * @param {unknown} url
 * @returns {string|null}
 */
export function hiresUrl(url) {
  if (typeof url !== 'string') return null;
  return HIRES_RE.test(url) ? url.replace(/\.png$/, '_hires.png') : url;
}

/**
 * Panel and total size so `panels` card-shaped panels fit the viewport.
 * @param {{panels:number, viewport:{w:number,h:number}, maxH?:number, vhShare?:number, ratio?:number, gap?:number, margin?:number}} o
 * @returns {{panelW:number, panelH:number, totalW:number, totalH:number}}
 */
export function loupeSize({ panels, viewport, maxH = 460, vhShare = 0.7, ratio = CARD_RATIO, gap = 16, margin = 16 }) {
  const n = panels === 2 ? 2 : 1;
  const widthLimit = (viewport.w - 2 * margin - (n - 1) * gap) / n / ratio;
  const raw = Math.min(maxH, vhShare * viewport.h, widthLimit);
  const h = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const panelH = Math.round(h);
  const panelW = Math.round(h * ratio);
  return { panelW, panelH, totalW: n * panelW + (n - 1) * gap, totalH: panelH + CAPTION_BAND_PX };
}

function clamp(v, lo, hi) {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

/**
 * Where to put the loupe relative to the hovered element.
 * @param {{anchor:{x:number,y:number,w:number,h:number}, size:{w:number,h:number}, viewport:{w:number,h:number}, margin?:number}} o
 * @returns {{x:number, y:number, side:'right'|'left'|'above'|'below'}}
 */
export function placeLoupe({ anchor, size, viewport, margin = 8 }) {
  const maxX = viewport.w - size.w - margin;
  const maxY = viewport.h - size.h - margin;
  const centeredY = clamp(anchor.y + anchor.h / 2 - size.h / 2, margin, maxY);
  const rightX = anchor.x + anchor.w + margin;
  if (rightX <= maxX) return { x: rightX, y: centeredY, side: 'right' };
  const leftX = anchor.x - margin - size.w;
  if (leftX >= margin) return { x: leftX, y: centeredY, side: 'left' };
  const x = clamp((viewport.w - size.w) / 2, margin, maxX);
  const roomAbove = anchor.y;
  const roomBelow = viewport.h - anchor.y - anchor.h;
  if (roomAbove > roomBelow) return { x, y: clamp(anchor.y - margin - size.h, margin, maxY), side: 'above' };
  return { x, y: clamp(anchor.y + anchor.h + margin, margin, maxY), side: 'below' };
}

/**
 * Docked placement (two-pane layout): the preview sits directly right of the left panel, its image top on the dock
 * image's top and as tall as the dock image, shrunk only to stay inside the window.
 * @param {{dock:{x:number,y:number,w:number,h:number}, panelRight:number, viewport:{w:number,h:number}, margin?:number, ratio?:number}} o
 * @returns {{x:number, y:number, panelW:number, panelH:number}}
 */
export function placeDocked({ dock, panelRight, viewport, margin = 8, ratio = CARD_RATIO }) {
  const x = panelRight + margin;
  const maxH = viewport.h - 2 * margin - 2 * LOUPE_PAD_PX - CAPTION_BAND_PX;
  const maxW = viewport.w - x - margin - 2 * LOUPE_PAD_PX;
  const h = Math.max(0, Math.min(dock.h, maxH, maxW / ratio));
  return { x, y: dock.y - LOUPE_PAD_PX, panelW: Math.round(h * ratio), panelH: Math.round(h) };
}

/**
 * Fixed placement (narrow layout): centered, at the top when the pointer is in the lower half of the window,
 * otherwise at the bottom. It never depends on the tile.
 * @param {{size:{w:number,h:number}, viewport:{w:number,h:number}, pointerY:number, margin?:number}} o
 * @returns {{x:number, y:number, side:'top'|'bottom'}}
 */
export function placeFixed({ size, viewport, pointerY, margin = 8 }) {
  const x = clamp((viewport.w - size.w) / 2, margin, viewport.w - size.w - margin);
  if (pointerY > viewport.h / 2) return { x, y: margin, side: 'top' };
  return { x, y: Math.max(margin, viewport.h - size.h - margin), side: 'bottom' };
}

/**
 * One-line caption for a tile: aria-label, else collapsed text, capped with an ellipsis.
 * @param {{getAttribute:(n:string)=>string|null, textContent:string|null}} el
 * @returns {string}
 */
export function captionOf(el) {
  const raw = el.getAttribute('aria-label') || String(el.textContent || '');
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > CAPTION_MAX_CHARS ? `${text.slice(0, CAPTION_MAX_CHARS - 1)}…` : text;
}

/**
 * DOM controller. Shows `loupeEl` for tiles under `root` matching `tileSelector`.
 * `compareFor(tile)` returns `{ main:{src,caption}, page:{src,caption}|null }`.
 * `mode(tile)` picks the placement: `{ kind:'docked', dock:{x,y,w,h}, panelRight }` (one panel at a fixed spot beside the
 * left panel), `{ kind:'fixed' }` (the panels at a fixed top or bottom spot), or null (beside the tile, as before).
 * `onTile(tile)` hears about every hovered or focused tile at once, before the open delay.
 * `focusTile(el)` names the tile a focused control stands for (a review pair's checkbox stands for its picture), or null; keyboard
 * focus on such a control previews that tile as hovering it does.
 * @returns {{hide:()=>void, refresh:()=>void, destroy:()=>void}}
 */
export function createLoupe({ doc, root, loupeEl, tileSelector, compareFor, mode = () => null, onTile = () => {}, focusTile = () => null, delayMs = 150, leaveMs = 80, reducedMotion = false }) {
  const win = doc.defaultView;
  let openTile = null;
  let showTimer = null;
  let hideTimer = null;
  let isOpen = false;
  let lastX = null;
  let lastY = null;
  let openedBy = 'pointer'; // 'focus' previews follow the focused tile, never the pointer position
  let pendingTile = null;

  loupeEl.setAttribute('aria-hidden', 'true');
  loupeEl.hidden = true;

  // The host (the compare dock) hears once per tile, as soon as it is aimed at.
  let notified = null;
  const notify = (tile) => { if (tile === notified || tile.isConnected === false) return; notified = tile; onTile(tile); };
  const tileOf = (target) => (target && typeof target.closest === 'function' ? target.closest(tileSelector) : null);
  // The tile a focused element is, or stands for.
  const focusedTile = (target) => tileOf(target) || (target ? focusTile(target) : null);
  const clearTimers = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  };

  function buildPanel(side, panelW, panelH) {
    const fig = doc.createElement('figure');
    fig.className = 'loupe-panel';
    const img = doc.createElement('img');
    img.alt = '';
    img.width = panelW;
    img.height = panelH;
    img.src = side.src;
    const hires = hiresUrl(side.src);
    if (hires && hires !== side.src) {
      const big = new win.Image();
      big.onload = () => { img.src = hires; };
      big.src = hires;
    }
    const cap = doc.createElement('figcaption');
    cap.textContent = side.caption || '';
    fig.append(img, cap);
    return fig;
  }

  // `rebuild` false keeps the panels already shown (no image reset or reload) and only recomputes size and position.
  function render(tile, rebuild) {
    const data = compareFor(tile);
    if (!data || !data.main || !data.main.src) return false;
    const where = mode(tile);
    const docked = where?.kind === 'docked';
    const sides = data.page && !docked ? [data.page, data.main] : [data.main];
    const viewport = { w: win.innerWidth, h: win.innerHeight };
    const r = tile.getBoundingClientRect();
    let size;
    let pos;
    if (docked) {
      const d = placeDocked({ dock: where.dock, panelRight: where.panelRight, viewport });
      size = { panelW: d.panelW, panelH: d.panelH, totalW: d.panelW, totalH: d.panelH + CAPTION_BAND_PX };
      pos = d;
    } else {
      size = loupeSize({ panels: sides.length, viewport, margin: 16 + LOUPE_PAD_PX });
      if (where?.kind !== 'fixed') {
        // The preview shrinks (down to MIN_BESIDE_PANEL_W per panel) to sit beside its tile instead of covering it.
        const beside = Math.max(viewport.w - r.right, r.left) - 20; // gap, margin and rounding slack
        const fitted = loupeSize({ panels: sides.length, viewport: { w: beside, h: viewport.h }, margin: LOUPE_PAD_PX });
        if (fitted.panelW >= MIN_BESIDE_PANEL_W && fitted.panelH < size.panelH) size = fitted;
      }
    }
    if (rebuild) {
      loupeEl.replaceChildren(...sides.map((s) => buildPanel(s, size.panelW, size.panelH)));
    } else {
      for (const img of loupeEl.querySelectorAll('img')) { // the size may have changed with the tile's position; src stays
        img.width = size.panelW;
        img.height = size.panelH;
      }
    }
    loupeEl.style.width = `${size.totalW}px`;
    loupeEl.style.height = `${size.totalH}px`;
    const box = { w: size.totalW + 2 * LOUPE_PAD_PX, h: size.totalH + 2 * LOUPE_PAD_PX };
    if (!docked) {
      pos = where?.kind === 'fixed'
        ? placeFixed({ size: box, viewport, pointerY: lastY ?? r.top + r.height / 2 })
        : placeLoupe({ anchor: { x: r.left, y: r.top, w: r.width, h: r.height }, size: box, viewport });
    }
    loupeEl.style.left = `${pos.x}px`;
    loupeEl.style.top = `${pos.y}px`;
    return true;
  }

  // A re-rendered list detaches its tiles without a pointerout; a detached tile has an all-zero rect.
  function show(tile, rebuild = true) {
    if (tile.isConnected === false || !render(tile, rebuild)) { hide(); return; }
    notify(tile);
    openTile = tile;
    isOpen = true;
    loupeEl.hidden = false;
    if (!reducedMotion) loupeEl.classList.add('is-open');
  }

  function hide() {
    clearTimers();
    openTile = null;
    pendingTile = null;
    isOpen = false;
    loupeEl.hidden = true;
    loupeEl.classList.remove('is-open');
  }

  // The tile a preview should be on now: the focused tile for a keyboard open, else the tile under the last pointer position.
  function aimedTile() {
    if (openedBy === 'focus') return focusedTile(doc.activeElement);
    return lastX === null ? null : tileOf(doc.elementFromPoint(lastX, lastY));
  }

  // Re-aim after the list was re-rendered or scrolled. `always` re-positions even when the tile is the one already shown.
  function reaim(always) {
    if (hideTimer) return;
    if (!isOpen && !showTimer) return;
    const t = aimedTile();
    if (!isOpen) { // a pending open: keep it on its tile, or move it to the tile now aimed at
      if (t === pendingTile && t && t.isConnected !== false) return;
      clearTimeout(showTimer);
      showTimer = null;
      pendingTile = t;
      if (t) showTimer = setTimeout(() => show(t), delayMs);
      return;
    }
    if (t) { if (always || t !== openTile) show(t, t !== openTile); return; }
    if (openedBy === 'focus') leave(); // the host re-focuses a moment later; focusin cancels this close
    else hide();
  }

  const refresh = () => reaim(false);

  function request(tile, by) {
    openedBy = by;
    notify(tile);
    clearTimeout(hideTimer);
    hideTimer = null;
    if (tile === openTile && tile.isConnected !== false) return;
    clearTimeout(showTimer);
    if (isOpen) show(tile);
    else { pendingTile = tile; showTimer = setTimeout(() => show(tile), delayMs); }
  }

  function leave() {
    clearTimeout(showTimer);
    showTimer = null;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, leaveMs);
  }

  const track = (e) => { lastX = e.clientX; lastY = e.clientY; };
  const onOver = (e) => { track(e); const t = tileOf(e.target); if (t) request(t, 'pointer'); };
  const onOut = (e) => { if (focusedTile(e.target)) leave(); };
  const onPointerOut = (e) => { if (tileOf(e.target)) { lastX = null; lastY = null; leave(); } };
  const onFocusIn = (e) => {
    const t = focusedTile(e.target);
    if (!t || !e.target.matches(':focus-visible')) return;
    lastX = null;
    lastY = null;
    request(t, 'focus');
  };
  const onScroll = () => reaim(true);
  const onKey = (e) => { if (e.key === 'Escape') hide(); };

  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointermove', track);
  root.addEventListener('pointerout', onPointerOut);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onOut);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('scroll', onScroll, true);
  win.addEventListener('blur', hide);

  function destroy() {
    hide();
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('pointermove', track);
    root.removeEventListener('pointerout', onPointerOut);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onOut);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('blur', hide);
  }

  return { hide, refresh, destroy };
}
