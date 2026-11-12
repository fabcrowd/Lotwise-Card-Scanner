// Injected into the tab the user scans (never declared in the manifest) — renders a full-viewport card-scanner overlay.
(function () {
  // Guard against double-injection — scripting.executeScript may re-run this file
  // on the same page (e.g. a scan followed by an overlay relay).
  if (window.__cardScannerLoaded) return;
  window.__cardScannerLoaded = true;

  // Remove any canvas left by a previous extension context (e.g. after reload).
  const _stale = document.getElementById('__card-scanner-overlay__');
  if (_stale) _stale.remove();

  let canvas       = null;
  let ctx          = null;
  // Boxes the overlay draws, each pinned to a page element or to a document position. Survives resize.
  let _placed      = [];
  let _raf         = 0;
  let _following   = false;
  // Scan index of the card the popup is asking about; its box is outlined until the pointer leaves that row.
  let _highlight   = null;
  // Card frames drawn in the last pass (viewport rects). Every card has a small tag; its full label shows only while the pointer is on it; the
  // canvas never takes the pointer, so that is a hit test against these on the page's own mousemove.
  let _targets     = [];
  let _hover       = null; // { target: index into _targets, index: scan index, rect: label rect }
  let _mouse       = null;
  let _clickable   = []; // drawn tags and the full-size pill a click can land on: { rect, index } or { rect, url }
  let _fullSize    = null; // { url } of a larger photo the scan could not read, offered on the page

  // The page elements (and their rects) of the last findCards, so a box can be pinned to the picture it came from.
  // Rects are in document coordinates so anchors from several scrolled screens can be matched at once.
  let _scanAnchors = [];
  let _anchorIds   = new Map();
  let _scanScroll  = { x: 0, y: 0 };
  // The viewport the scan measured the page in. Boxes arrive in its CSS px, so a box is placed with it even after the
  // window was resized (the popup pushes the overlay again whenever a price or a pick changes).
  let _scanView    = null;

  const MIN_ANCHOR_SHARE = 0.9;

  function boxToRel(box, r, paintedRect) {
    // Use paintedRect for letterboxed images, otherwise fall back to full element rect
    const useRect = paintedRect || r;
    const w = useRect.right - useRect.left;
    const h = useRect.bottom - useRect.top;
    if (!(w > 0) || !(h > 0)) return null;
    return [(box[0] - useRect.left) / w, (box[1] - useRect.top) / h, (box[2] - useRect.left) / w, (box[3] - useRect.top) / h];
  }

  function relToBox(rel, r) {
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    return [r.left + rel[0] * w, r.top + rel[1] * h, r.left + rel[2] * w, r.top + rel[3] * h];
  }

  function boxToDoc(box, scroll) {
    return [box[0] + scroll.x, box[1] + scroll.y, box[2] + scroll.x, box[3] + scroll.y];
  }

  function docToBox(doc, scroll) {
    return [doc[0] - scroll.x, doc[1] - scroll.y, doc[2] - scroll.x, doc[3] - scroll.y];
  }

  // The smallest element that holds (nearly all of) the box; -1 when the box came from no known element.
  // Uses paintedRect when available (for letterboxed images), otherwise falls back to full element rect.
  function pickAnchor(box, anchors) {
    const area = Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
    let best = -1;
    let bestArea = Infinity;
    anchors.forEach((a, i) => {
      const r = a.paintedRect || a.rect;
      const w = Math.min(box[2], r.right) - Math.max(box[0], r.left);
      const h = Math.min(box[3], r.bottom) - Math.max(box[1], r.top);
      if (!(area > 0) || w <= 0 || h <= 0 || (w * h) / area < MIN_ANCHOR_SHARE) return;
      const rectArea = (r.right - r.left) * (r.bottom - r.top);
      if (rectArea < bestArea) { best = i; bestArea = rectArea; }
    });
    return best;
  }

  function boxInView(box, width, height) {
    return box[2] > 0 && box[3] > 0 && box[0] < width && box[1] < height;
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = '__card-scanner-overlay__';
    Object.assign(canvas.style, {
      position:      'fixed',
      top:           '0',
      left:          '0',
      width:         '100vw',
      height:        '100vh',
      pointerEvents: 'none',
      zIndex:        '2147483647',
    });
    document.documentElement.appendChild(canvas);
    fitCanvas();
    followPage();
  }

  // Capture-phase so a scrolling container inside the page moves the overlay too (scroll does not bubble).
  function followPage() {
    if (_following) return;
    _following = true;
    window.addEventListener('scroll', scheduleDraw, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseout', onMouseOut, { passive: true });
    window.addEventListener('click', onClick, true);
  }

  function unfollowPage() {
    if (!_following) return;
    _following = false;
    window.removeEventListener('scroll', scheduleDraw, { capture: true });
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseout', onMouseOut);
    window.removeEventListener('click', onClick, true);
    _clickable = [];
    _mouse = null;
    _hover = null;
    if (_raf) window.cancelAnimationFrame(_raf);
    _raf = 0;
  }

  // Frames to keep redrawing after the layout changed: a site may size its photo from script a frame or more after
  // the resize event, and a photo that only moves fires no ResizeObserver.
  const SETTLE_FRAMES = 30;
  let _settleFrames = 0;

  function scheduleDraw() {
    if (_raf) return;
    _raf = window.requestAnimationFrame(() => {
      _raf = 0;
      _drawOverlay();
      if (_settleFrames > 0) {
        _settleFrames--;
        scheduleDraw();
      }
    });
  }

  function followLayout() {
    _settleFrames = SETTLE_FRAMES;
    scheduleDraw();
  }

  function onResize() {
    followLayout();
  }

  // ─── Anchored photos ──────────────────────────────────────────────────────
  // A box is drawn on the photo it was found in, at that photo's current rect. A photo rescaled by the page
  // (ResizeObserver), swapped by a carousel (src/srcset) or removed (childList) redraws the overlay at once.
  let _sizeWatch = null;
  let _anchorWatch = null;
  let _watched = new Set();

  // What picture an element shows: an <img>'s src and srcset attributes (a responsive pick of another size changes
  // currentSrc, not these), or an element's background image.
  function sourceOf(el) {
    if (el.tagName === 'IMG') return `${el.getAttribute('src') || ''} ${el.getAttribute('srcset') || ''}`;
    return getComputedStyle(el).backgroundImage || '';
  }

  // Only changes to an anchored photo or one of its ancestors count; the rest of a busy page mutates all the time.
  function onPageMutation(records) {
    for (const record of records) {
      if (record.type === 'childList') {
        const gone = [..._watched].filter((el) => !el.isConnected);
        if (!gone.length) continue;
        gone.forEach((el) => _watched.delete(el));
        followLayout();
        return;
      }
      if ([..._watched].some((el) => record.target === el || record.target?.contains?.(el))) {
        followLayout();
        return;
      }
    }
  }

  function watchAnchors() {
    unwatchAnchors();
    _watched = new Set(_placed.filter((p) => p.el && p.el.isConnected).map((p) => p.el));
    if (!_watched.size) return;
    const Sizes = window.ResizeObserver;
    if (typeof Sizes === 'function') {
      _sizeWatch = new Sizes(() => followLayout());
      for (const el of _watched) _sizeWatch.observe(el);
    }
    _anchorWatch = new MutationObserver(onPageMutation);
    _anchorWatch.observe(document.body || document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'class'],
    });
  }

  function unwatchAnchors() {
    _sizeWatch?.disconnect();
    _anchorWatch?.disconnect();
    _sizeWatch = null;
    _anchorWatch = null;
    _watched = new Set();
  }

  function onMouseMove(e) {
    _mouse = { x: e.clientX, y: e.clientY };
    if (hoveredTarget(_targets, _hover, _mouse) !== (_hover?.target ?? null)) scheduleDraw();
  }

  // No relatedTarget: the pointer left the window, so no later mousemove will close the panel.
  function onMouseOut(e) {
    if (e.relatedTarget) return;
    _mouse = null;
    if (_hover) scheduleDraw();
  }

  function inRect(rect, point) {
    return Boolean(rect && point) && point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
  }

  /**
   * Which card the pointer is on: the smallest frame or tag under it (a card inside a larger photo box wins, and so
   * does a tag drawn just outside its card), or the open one while the pointer is still on its label, which may stick
   * out past a small card. Null when on neither.
   */
  function hoveredTarget(targets, hover, point) {
    if (!point) return null;
    if (hover && targets[hover.target] && inRect(hover.rect, point)) return hover.target;
    let best = null;
    let bestArea = Infinity;
    targets.forEach((t, i) => {
      for (const r of [t.rect, t.tag]) {
        if (!inRect(r, point)) continue;
        const area = r.w * r.h;
        if (area < bestArea) { best = i; bestArea = area; }
      }
    });
    return best;
  }

  // Drawing is in CSS pixels; the backing store is device pixels so text stays sharp on high-DPI screens.
  // The canvas is 100vw wide, but with a page scrollbar the width it is laid out at is the layout viewport's
  // (clientWidth), not window.innerWidth. The bitmap must match that CSS size or it is squeezed on screen.
  let _cssW = 0;
  let _cssH = 0;

  function canvasBacking(cssW, cssH, dpr) {
    return { width: Math.max(1, Math.round(cssW * dpr)), height: Math.max(1, Math.round(cssH * dpr)) };
  }

  // The CSS size the canvas is actually laid out at; the viewport size until it has been measured.
  function measureCanvas() {
    const r = canvas ? canvas.getBoundingClientRect() : null;
    return {
      w: r && r.width > 0 ? r.width : window.innerWidth,
      h: r && r.height > 0 ? r.height : window.innerHeight,
    };
  }

  function viewW() { return _cssW || window.innerWidth; }
  function viewH() { return _cssH || window.innerHeight; }

  // Resizing a canvas clears it, so only when the CSS size or the pixel ratio changed.
  function sizeBacking() {
    const dpr = window.devicePixelRatio || 1;
    const css = measureCanvas();
    const want = canvasBacking(css.w, css.h, dpr);
    if (ctx && canvas.width === want.width && canvas.height === want.height && _cssW === css.w && _cssH === css.h) return false;
    _cssW = css.w;
    _cssH = css.h;
    canvas.width  = want.width;
    canvas.height = want.height;
    ctx = canvas.getContext('2d');
    // Exactly bitmap / CSS size, so rounding the bitmap never shifts a box.
    ctx.setTransform(want.width / css.w, 0, 0, want.height / css.h, 0, 0);
    return true;
  }

  function fitCanvas() {
    if (!canvas) return;
    sizeBacking();
    _drawOverlay();
  }

  function clearOverlay() {
    stopObserving();
    unfollowPage();
    unwatchAnchors();
    _settleFrames = 0;
    _placed = [];
    _highlight = null;
    _fullSize = null;
    if (!canvas) return;
    canvas.remove();
    canvas = null;
    ctx    = null;
    _cssW  = 0;
    _cssH  = 0;
  }

  // ─── Lazy-load observer ────────────────────────────────────────────────────
  // Watches for new <img> nodes added to the DOM (infinite scroll, lazy load)
  // and notifies the background to re-scan when card-shaped images appear that
  // weren't present at the last scan baseline.

  let _observer     = null;
  let _observerTimer = null;
  // What every picture loaded at the last scan shows. A picture laid out again (a window resize, a copy of the photo
  // drawn as a backdrop, one scrolled into view, a larger file from the same srcset) is not new; only an image added
  // or loaded since is.
  let _baselineSrcs  = new Set();

  function pictureKeys(img) {
    return [img.currentSrc || img.src || '', `${img.getAttribute('src') || ''} ${img.getAttribute('srcset') || ''}`.trim()].filter(Boolean);
  }

  function _loadedPictureKeys() {
    const keys = new Set();
    for (const img of document.querySelectorAll('img')) {
      if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) continue;
      for (const key of pictureKeys(img)) keys.add(key);
    }
    return keys;
  }

  function startObserving() {
    _baselineSrcs = _loadedPictureKeys(); // re-baseline on every scan completion
    if (_observer) return;          // only wire up the observer once
    _observer = new MutationObserver(() => {
      clearTimeout(_observerTimer);
      _observerTimer = setTimeout(_checkNewCardSrcs, 500);
    });
    _observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree:   true,
    });
  }

  function stopObserving() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
    clearTimeout(_observerTimer);
    _observerTimer = null;
    _baselineSrcs.clear();
  }

  // Loaded, card-shaped pictures on screen now.
  function _cardImagesOnScreen() {
    const found = [];
    for (const img of document.querySelectorAll('img')) {
      if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) continue;
      const r = img.getBoundingClientRect();
      if (r.width < CARD_MIN_W || r.height < CARD_MIN_H) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) continue;
      const ratio = r.height > 0 ? r.width / r.height : 0;
      if (ratio < CARD_RATIO_MIN || ratio > CARD_RATIO_MAX) continue;
      found.push(img);
    }
    return found;
  }

  function _checkNewCardSrcs() {
    const fresh = _cardImagesOnScreen().filter((img) => !pictureKeys(img).some((key) => _baselineSrcs.has(key)));
    if (!fresh.length) return;
    // The pictures that asked join the baseline, so they never ask again.
    for (const img of fresh) for (const key of pictureKeys(img)) _baselineSrcs.add(key);
    chrome.runtime.sendMessage({ action: 'newCardsDetected' }).catch(() => {});
  }

  // A screenshot taken with the badges drawn over the cards is read as badges, not cards, so the scan
  // hides the overlay for its capture (lib/tab-messaging.js captureWithoutOverlay) and shows it again right after:
  // the boxes follow their photos until the scan's result replaces them.
  function hideOverlay(done) {
    if (!canvas) { done(); return; }
    canvas.style.visibility = 'hidden';
    // One frame is not enough: the compositor may still hold the last painted frame.
    window.requestAnimationFrame(() => window.requestAnimationFrame(done));
  }

  // Lazy pictures start loading only once they are near the screen; a capture before they finish shows blanks.
  const SETTLE_MIN_MS = 150;
  const SETTLE_MAX_MS = 800;

  function cardImagesLoading() {
    for (const img of document.querySelectorAll('img')) {
      if (img.complete) continue;
      const r = img.getBoundingClientRect();
      if (r.width < CARD_MIN_W || r.height < CARD_MIN_H) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) continue;
      return true;
    }
    return false;
  }

  function scrollToAndSettle(x, y, done) {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
    const started = Date.now();
    const poll = () => {
      const waited = Date.now() - started;
      if (waited >= SETTLE_MAX_MS || (waited >= SETTLE_MIN_MS && !cardImagesLoading())) {
        done({ scrollX: window.scrollX, scrollY: window.scrollY });
        return;
      }
      setTimeout(poll, 50);
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(poll));
  }

  // The popup's "Show boxes on page". Off hides the overlay but keeps its boxes, so turning it on brings them back.
  let _shown = true;

  function showCanvas() {
    if (canvas) canvas.style.visibility = _shown ? 'visible' : 'hidden';
  }

  function setOverlayShown(shown) {
    _shown = shown;
    showCanvas();
    _drawOverlay();
  }

  function restoreOverlay() {
    showCanvas();
  }

  function renderOverlay(cards, srcWidth, srcHeight) {
    ensureCanvas();
    showCanvas();
    // Boxes arrive in the viewport the screenshot was taken at (innerWidth x innerHeight then), whatever the canvas CSS
    // size. The anchors were measured in that viewport too, so the window as it is now plays no part.
    const view = _scanView || { w: window.innerWidth, h: window.innerHeight };
    const scaleX = view.w / srcWidth;
    const scaleY = view.h / srcHeight;
    _placed = [];
    for (const [index, card] of cards.entries()) {
      if (!card.box || card.box.length < 4) continue;
      // A card read from another photo of the gallery is not on the page; the popup lists it with its photo.
      if (card.inGallery) continue;
      const [x1, y1, x2, y2] = card.box;
      // A whole-page scan reports document boxes; a single screen reports boxes in the viewport it was taken in.
      const doc = card.docBox && card.docBox.length >= 4
        ? card.docBox
        : boxToDoc([x1 * scaleX, y1 * scaleY, x2 * scaleX, y2 * scaleY], _scanScroll);
      const anchor = pickAnchor(doc, _scanAnchors);
      const anchorData = anchor >= 0 ? _scanAnchors[anchor] : null;
      const rel = anchorData ? boxToRel(doc, anchorData.rect, anchorData.paintedRect) : null;
      _placed.push(rel
        ? { card, index, el: anchorData.el, rel, source: anchorData.source }
        : { card, index, doc });
    }
    watchAnchors();
    _drawOverlay();
  }

  function highlightCard(index, scroll) {
    _highlight = Number.isInteger(index) ? index : null;
    const p = _highlight == null ? null : _placed.find((q) => q.index === _highlight);
    if (scroll && p) {
      const box = _placedBox(p);
      if (box && !boxFullyInView(box, window.innerWidth, window.innerHeight)) {
        window.scrollBy({ left: 0, top: (box[1] + box[3]) / 2 - window.innerHeight / 2, behavior: 'smooth' });
      }
    }
    _drawOverlay();
  }

  function boxFullyInView(box, width, height) {
    return box[0] >= 0 && box[1] >= 0 && box[2] <= width && box[3] <= height;
  }

  function _placedBox(p) {
    return _placedView(p)?.box ?? null;
  }

  /**
   * Where a placed card is now: its box on the photo's current rect, and the part of the screen it may be drawn in
   * (the photo's visible rect; the viewport for a box pinned to the document). Null while its photo is gone or shows
   * another picture.
   */
  function _placedView(p) {
    const viewport = { x1: 0, y1: 0, x2: viewW(), y2: viewH() };
    if (!p.el) return { box: docToBox(p.doc, { x: window.scrollX, y: window.scrollY }), clip: viewport };
    if (!p.el.isConnected || (p.source !== undefined && sourceOf(p.el) !== p.source)) return null;
    const r = p.el.getBoundingClientRect();
    // For letterboxed images, use the painted rect for box positioning (matches how rel was computed at scan time)
    let painted = null;
    if (p.el.tagName === 'IMG') {
      const style = getComputedStyle(p.el);
      painted = paintedBox(r, p.el.naturalWidth, p.el.naturalHeight, style.objectFit || 'fill', style.objectPosition || '50% 50%');
    }
    const boxRect = painted || r;
    return { box: relToBox(p.rel, boxRect), clip: visibleRect(p.el, r) };
  }

  // A fixed or sticky bar (a site header) painted over the photo hides the part of the photo under it.
  const MAX_COVER_PROBES = 3;

  function coveringBar(node, el) {
    for (let p = node, depth = 0; p && depth < MAX_ANCESTORS; p = p.parentElement, depth++) {
      if (p.contains?.(el)) return null;
      const position = getComputedStyle(p).position;
      if (position === 'fixed' || position === 'sticky') return p;
    }
    return null;
  }

  // The bar painted over `el` at this point, or null when `el` (or something inside it) is on top there.
  function coverAt(el, x, y) {
    if (typeof document.elementsFromPoint !== 'function') return null;
    for (const top of document.elementsFromPoint(x, y)) {
      if (top === canvas) continue;
      if (top === el || el.contains?.(top)) return null;
      const bar = coveringBar(top, el);
      if (bar) return bar.getBoundingClientRect();
    }
    return null;
  }

  // A CSS position as fractions [x, y], read the way photo-detection.js reads it; null for one it cannot read.
  function positionFractions(position = '50% 50%') {
    const words = String(position).trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [0.5, 0.5];
    if (words.length > 2) return null;
    if (words.length === 1) {
      if (words[0] === 'top' || words[0] === 'bottom') words.unshift('center');
      else words.push('center');
    }
    const fraction = (token) => {
      if (token === 'center') return 0.5;
      if (token === 'left' || token === 'top') return 0;
      if (token === 'right' || token === 'bottom') return 1;
      const percent = token.match(/^(-?\d+(?:\.\d+)?)%$/);
      return percent ? Number(percent[1]) / 100 : null;
    };
    let [x, y] = words;
    if ((x === 'top' || x === 'bottom') && (y === 'left' || y === 'right')) [x, y] = [y, x];
    const fx = fraction(x);
    const fy = fraction(y);
    return fx === null || fy === null ? null : [fx, fy];
  }

  /**
   * Where an <img> paints its picture inside its box r (object-fit, object-position), placed exactly as
   * imageToViewportTransform in photo-detection.js places it (tests/overlay-labels.test.js checks they agree).
   * Null when the picture has no size or the position cannot be read.
   */
  function paintedBox(r, naturalW, naturalH, fit = 'fill', position = '50% 50%') {
    if (!(naturalW > 0) || !(naturalH > 0)) return null;
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    const contain = Math.min(w / naturalW, h / naturalH);
    const cover = Math.max(w / naturalW, h / naturalH);
    let sx = w / naturalW;
    let sy = h / naturalH;
    if (fit === 'contain' || fit === 'cover' || fit === 'scale-down') {
      sx = sy = fit === 'cover' ? cover : fit === 'scale-down' ? Math.min(1, contain) : contain;
    } else if (fit === 'none') {
      sx = sy = 1;
    }
    const at = positionFractions(position);
    if (!at) return null;
    const left = r.left + (w - naturalW * sx) * at[0];
    const top = r.top + (h - naturalH * sy) * at[1];
    return { left, top, right: left + naturalW * sx, bottom: top + naturalH * sy };
  }

  function paintedRectOf(el, r) {
    if (el.tagName !== 'IMG') return null;
    const style = getComputedStyle(el);
    return paintedBox(r, el.naturalWidth, el.naturalHeight, style.objectFit || 'fill', style.objectPosition || '50% 50%');
  }

  /**
   * The photo's visible rect: inside the viewport and its clipping ancestors, below/above any bar over it, and on
   * the picture itself (an object-fit: contain photo's letterbox is not the photo).
   */
  function visibleRect(el, r) {
    const v = visibleBox(el, r);
    const painted = paintedRectOf(el, r);
    const x1 = Math.max(v.vx, painted ? painted.left : -Infinity);
    let y1 = Math.max(v.vy, painted ? painted.top : -Infinity);
    const x2 = Math.min(v.vx + v.vw, painted ? painted.right : Infinity);
    let y2 = Math.min(v.vy + v.vh, painted ? painted.bottom : Infinity);
    if (x2 <= x1 || y2 <= y1) return { x1, y1, x2: x1, y2: y1 };
    const x = (x1 + x2) / 2;
    for (let i = 0; i < MAX_COVER_PROBES && y2 > y1; i++) {
      const bar = coverAt(el, x, y1 + 0.5);
      if (!bar || bar.bottom <= y1) break;
      y1 = Math.min(y2, bar.bottom);
    }
    for (let i = 0; i < MAX_COVER_PROBES && y2 > y1; i++) {
      const bar = coverAt(el, x, y2 - 0.5);
      if (!bar || bar.top >= y2) break;
      y2 = Math.max(y1, bar.top);
    }
    return { x1, y1, x2, y2 };
  }

  function clipTo(clip) {
    ctx.beginPath();
    ctx.rect(clip.x1, clip.y1, Math.max(0, clip.x2 - clip.x1), Math.max(0, clip.y2 - clip.y1));
    ctx.clip();
  }

  function _drawOverlay() {
    if (!canvas) return;
    // A scrollbar can appear or go without a resize event; follow the canvas's real CSS size on every pass.
    sizeBacking();
    ctx.clearRect(0, 0, viewW(), viewH());
    // Hidden by the user: nothing drawn, hovered or clicked.
    if (!_shown) {
      _targets = [];
      _clickable = [];
      _hover = null;
      return;
    }

    const previous = _hover;
    // The hovered card's tag is not drawn while its label is open, so its last spot is kept for the hit test.
    const lastTags = new Map(_targets.filter((t) => t.tag).map((t) => [t.index, t.tag]));
    _targets = [];
    for (const p of _placed) {
      const view = _placedView(p);
      if (!view || !boxInView(view.box, viewW(), viewH())) continue;
      const { box, clip } = view;
      const [sx1, sy1, sx2, sy2] = box;
      // Only the part of the card on the visible photo is drawn, hovered or clicked.
      const seen = { x1: Math.max(sx1, clip.x1), y1: Math.max(sy1, clip.y1), x2: Math.min(sx2, clip.x2), y2: Math.min(sy2, clip.y2) };
      if (seen.x2 <= seen.x1 || seen.y2 <= seen.y1) continue;
      const card = p.card;
      const state = cardState(card);
      const color = STATE_COLORS[state];
      ctx.save();
      clipTo(clip);
      if (p.index === _highlight) drawHighlight(sx1, sy1, sx2, sy2);
      drawFrame(sx1, sy1, sx2, sy2, color, state === 'none');
      ctx.restore();
      _targets.push({ rect: { x: seen.x1, y: seen.y1, w: seen.x2 - seen.x1, h: seen.y2 - seen.y1 }, tag: lastTags.get(p.index), box, clip, card, color, index: p.index });
    }

    const kept = previous ? { target: _targets.findIndex((t) => t.index === previous.index), rect: previous.rect } : null;
    const hit = hoveredTarget(_targets, kept, _mouse);
    // Every card carries a small tag (name and number, price): placed where it overlaps no other tag, else left to hover.
    const taken = [];
    _clickable = [];
    const pill = _fullSize ? drawFullSizePill(_targets) : null;
    if (pill) {
      taken.push(pill);
      _clickable.push({ rect: pill, url: _fullSize.url });
    }
    for (const [i, t] of _targets.entries()) {
      if (i === hit || t.index === _highlight) continue;
      ctx.save();
      clipTo(t.clip);
      const rect = drawTag(t.box, t.card, taken, _targets.filter((u) => u !== t).map((u) => u.box), t.clip, t.index);
      ctx.restore();
      t.tag = rect || undefined;
      if (rect) {
        taken.push(rect);
        if (cardState(t.card) !== 'identified') _clickable.push({ rect, index: t.index });
      }
    }

    // The full label is drawn last so it sits over neighbouring cards: the hovered card, and the one the popup points at.
    _hover = null;
    for (const [i, t] of _targets.entries()) {
      if (i !== hit && t.index !== _highlight) continue;
      ctx.save();
      // The full label may be wider than a small card, but stays on the visible photo (never over a bar above it).
      clipTo(t.clip);
      const rect = drawLabel(t.box, t.card, t.color, t.clip);
      ctx.restore();
      if (rect && cardState(t.card) !== 'identified') _clickable.push({ rect, index: t.index });
      if (i === hit) _hover = { target: i, index: t.index, rect };
    }
  }

  // "Open full-size photo": drawn above the first row of the photo's cards when the scan found the cards small and a
  // larger picture it could not read itself. Clicking it opens that picture in a new tab.
  const PILL_TEXT = 'Open full-size photo for better results ↗';
  function drawFullSizePill(targets) {
    const onPage = targets.filter((t) => !t.card?.inGallery);
    if (!onPage.length) return null;
    const left = Math.min(...onPage.map((t) => t.box[0]));
    const top = Math.min(...onPage.map((t) => t.box[1]));
    const right = Math.max(...onPage.map((t) => t.box[2]));
    // Never over a bar above the photos.
    const floor = Math.max(4, Math.min(...onPage.map((t) => t.clip.y1)) + 4);
    ctx.save();
    ctx.font = `700 14px ${LABEL_FONT}`;
    const w = Math.ceil(ctx.measureText(PILL_TEXT).width) + 24;
    const h = 28;
    const x = Math.max(4, Math.min(left + (right - left - w) / 2, viewW() - w - 4));
    const y = Math.max(floor, Math.min(top - h - 6 < floor ? top + 4 : top - h - 6, viewH() - h - 4));
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(PILL_TEXT, x + 12, y + h / 2 + 1);
    ctx.restore();
    return { x, y, w, h };
  }

  // A click on a guess or question tag opens its pick list in the scanner; on the pill, the full-size photo.
  // Only clicks inside a drawn tag are taken; everything else reaches the page as before.
  // A page script can dispatch a click at the overlay; only a real user click (isTrusted) is taken.
  function acceptClick(e) {
    return e?.isTrusted === true;
  }

  function onClick(e) {
    if (!acceptClick(e)) return;
    const point = { x: e.clientX, y: e.clientY };
    const hit = [..._clickable].reverse().find((c) => inRect(c.rect, point));
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    if (hit.url) window.open(hit.url, '_blank', 'noopener');
    else chrome.runtime.sendMessage({ action: 'overlayPick', index: hit.index }).catch(() => {});
  }

  const HIGHLIGHT_COLOR = '#6366f1';

  function drawHighlight(x1, y1, x2, y2) {
    ctx.save();
    ctx.fillStyle = 'rgba(99,102,241,0.18)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = HIGHLIGHT_COLOR;
    ctx.lineWidth = 4;
    ctx.shadowColor = HIGHLIGHT_COLOR;
    ctx.shadowBlur = 12;
    ctx.strokeRect(x1 - 2, y1 - 2, x2 - x1 + 4, y2 - y1 + 4);
    ctx.restore();
  }

  // A whole outline in the card's state colour over a dark edge, so it shows on light and dark photos alike.
  function drawFrame(x1, y1, x2, y2, color, dashed) {
    const w = x2 - x1;
    const h = y2 - y1;
    const r = Math.min(8, w / 10, h / 10);
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x1, y1, w, h, r);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x1, y1, w, h, r);
    ctx.stroke();
  }

  // What a card's frame and tag say: identified (green), identified with its printing to pick (blue), choose (amber:
  // the user picks the card, no name or price shown), card back (grey, dashed). The popup sends its own verdict
  // (display.state) so the page and the list agree; a relay straight from the background falls back to the card's own fields.
  const STATE_COLORS = { identified: '#10b981', printing: '#3b82f6', choose: '#f59e0b', none: '#9ca3af', skipped: '#9ca3af' };
  const STATE_TEXT = { identified: '#6ee7b7', printing: '#93c5fd', choose: '#fcd34d', none: '#d1d5db', skipped: '#d1d5db' };

  function cardState(card) {
    const state = card?.display?.state;
    if (state && STATE_COLORS[state]) return state;
    if (card?.cardBack) return 'none';
    if (card?.abstain || !card?.identity?.name || card.unsure || card.lowCertainty) return 'choose';
    return 'identified';
  }

  /** A Choose card's best match as 'name? ~$1.20' (unconfirmed): an old price or none is said, never shown as a figure. */
  function guessLine(guess) {
    if (!guess?.name) return '';
    if (guess.price == null) return guess.kind === 'none' ? `${guess.name}? no price` : `${guess.name}?`;
    return guess.stale ? `${guess.name}? old price` : `${guess.name}? ~${money(guess.price)}`;
  }

  /**
   * A tag's lines: the name with its number, then the price (a range while the printing is open) or what to do.
   * `marker` is the card's row number in the scanner (scan index + 1), shown when not even a name stub fits.
   */
  function tagText(card, index) {
    const marker = Number.isInteger(index) ? String(index + 1) : '';
    return { ...tagLines(card), marker };
  }

  function tagLines(card) {
    const state = cardState(card);
    if (state === 'none') return { state, lines: ['Not recognised', 'Turn it over'], short: '?' };
    if (state === 'skipped') return { state, lines: ['Skipped'], short: 'Skipped' };
    if (state === 'choose') {
      const guess = guessLine(card.display?.guess);
      const ask = card.display?.highValue ? 'High value, double-check' : 'Tap to choose';
      return guess
        ? { state, lines: [guess, ask], short: guess, guessName: card.display.guess.name }
        : { state, lines: ['Choose', ask], short: 'Choose' };
    }
    const { name, price, caveat } = labelText(card);
    const number = card.display?.number || card.identity?.number || '';
    const title = number ? `${name} #${number}` : name;
    const priced = price && price !== '—' ? price : '';
    if (state === 'printing') {
      const note = caveat && priced ? `Set not sure · ${priced}` : priced ? `${priced} · pick printing` : 'Pick printing';
      return { state, lines: [title, note], short: priced || name, name, title, price: priced, note, highValue: card.display?.highValue === true };
    }
    return { state, lines: [title, priced || '—'], short: priced || name, name, title, price: priced, highValue: card.display?.highValue === true };
  }

  // A price is never cut mid-number: the whole of it, or "from" its lower bound, or nothing.
  function fitPrice(price, maxPx, measure) {
    if (!price) return '';
    if (measure(price) <= maxPx) return price;
    const low = /^(\$[\d,.]+)\s*[–-]/.exec(price);
    const from = low ? `from ${low[1]}` : '';
    return from && measure(from) <= maxPx ? from : '';
  }

  // A name shows whole, or cut with an ellipsis while at least four of its letters still show.
  const MIN_STUB_LETTERS = 4;
  function fitName(name, maxPx, measure) {
    if (!name) return '';
    if (measure(name) <= maxPx) return name;
    const text = fitText(name, maxPx, measure);
    return text.replace('…', '').replace(/\s/g, '').length >= MIN_STUB_LETTERS ? text : '';
  }

  // A tag always says which card it is: a name stub, or with no room for one, the card's row number; never a bare price.
  function nameOrMarker(name, marker, maxPx, measure) {
    return fitName(name, maxPx, measure) || (marker && measure(marker) <= maxPx ? marker : '');
  }

  /** The rows a tag prints: the Choose ask collapses to "Choose" when it does not fit; a small tag shows the name, then price. */
  function tagRows(tag, twoLines, textMax, measure) {
    const { state, lines, short, marker } = tag;
    if (state === 'choose') {
      const first = measure(short) <= textMax ? short
        : tag.guessName ? nameOrMarker(`${tag.guessName}?`, marker, textMax, measure)
        : fitText(short, textMax, measure);
      return (twoLines && first && measure(lines[1]) <= textMax ? [first, lines[1]] : [first]).filter(Boolean);
    }
    if (state === 'skipped') return [fitText(short, textMax, measure)].filter(Boolean);
    if (state === 'none') return (twoLines ? lines : [short]).map((t) => fitText(t, textMax, measure)).filter(Boolean);
    const { name, title, price } = tag;
    if (twoLines) {
      const first = nameOrMarker(title, marker, textMax, measure);
      if (!first) return [];
      const pickNote = state === 'printing' ? tag.note : '';
      const flagged = tag.highValue && price ? `${price} · High value, double-check` : '';
      const second = flagged && measure(flagged) <= textMax ? flagged
        : pickNote && measure(pickNote) <= textMax ? pickNote
        : fitPrice(price, textMax, measure) || (state === 'printing' && measure('Pick printing') <= textMax ? 'Pick printing' : '');
      return [first, second].filter(Boolean);
    }
    const both = price ? `${name} ${price}` : name;
    if (measure(both) <= textMax) return [both];
    return [nameOrMarker(name, marker, textMax, measure)].filter(Boolean);
  }

  // Tag size follows the card: 13 px text on a 60 px card up to 16 px; a short card gets one line.
  const TAG_MIN_W = 36;
  function tagLayout(boxW, boxH) {
    const px = Math.max(13, Math.min(16, Math.round(boxW / 8)));
    return { px, lines: boxW >= 80 && boxH >= 4 * px + 20 ? 2 : 1, maxWidth: Math.max(0, boxW - 4) };
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  // A neighbour's top edge is where its art starts and its own tag sits: a tag never covers that band.
  const TAG_TOP_BAND = 24;

  function onNeighbour(rect, other, topOnly) {
    const band = { x: other[0], y: other[1], w: other[2] - other[0], h: topOnly ? Math.min(TAG_TOP_BAND, other[3] - other[1]) : other[3] - other[1] };
    return overlaps(rect, band);
  }

  /**
   * Where a tag goes: inside the top of its card, inside the bottom, just above, just below; the first free spot.
   * A spot on another tag is never taken. A spot on a neighbouring card (others: the other cards' boxes) is skipped
   * too, or, when relaxed, only a spot on a neighbour's top edge is.
   */
  function placeTag(box, w, h, taken, view, others = [], relaxed = false) {
    // relaxed: false = clear of every neighbour; true = clear of neighbours' top edges; null = neighbours ignored.
    // view: the area a tag must stay in (the photo's visible rect), at view.x/view.y (0 when absent).
    const [x1, y1, , y2] = box;
    const vx = view.x || 0;
    const vy = view.y || 0;
    const x = Math.max(vx + 2, Math.min(x1 + 2, vx + view.w - w - 2));
    // Inside the top and bottom of the part of the box that shows: a box under a site header keeps its tag.
    const top = Math.max(y1, vy) + 2;
    const bottom = Math.min(y2, vy + view.h) - h - 2;
    for (const y of [top, bottom, y1 - h - 2, y2 + 2]) {
      if (y < vy + 2 || y + h > vy + view.h - 2) continue;
      const rect = { x, y, w, h };
      if (taken.some((other) => overlaps(other, rect))) continue;
      if (relaxed !== null && others.some((other) => onNeighbour(rect, other, relaxed))) continue;
      return rect;
    }
    return null;
  }

  /**
   * Tries each size (full first, then shorter) on no neighbour at all, then on no neighbour's top edge, and last,
   * so a card whose box overlaps its neighbours' keeps a tag, anywhere clear of other tags.
   * Returns { rect, size: index into sizes } or null, so a crowded photo shrinks a tag before it covers a card.
   */
  function placeTagLadder(box, sizes, taken, view, others = []) {
    for (const relaxed of [false, true, null]) {
      for (const [size, { w, h }] of sizes.entries()) {
        const rect = placeTag(box, w, h, taken, view, others, relaxed);
        if (rect) return { rect, size };
      }
    }
    return null;
  }

  function drawTag(box, card, taken, others = [], clip = { x1: 0, y1: 0, x2: viewW(), y2: viewH() }, index) {
    const layout = tagLayout(box[2] - box[0], box[3] - box[1]);
    if (layout.maxWidth < TAG_MIN_W) return null;
    const tag = tagText(card, index);
    const { state } = tag;
    const PAD_X = 7;
    const PAD_Y = 4;
    const ACCENT_W = 4;
    const GAP = 2;
    const textMax = Math.max(0, layout.maxWidth - ACCENT_W - PAD_X * 2);
    ctx.font = `800 ${layout.px}px ${LABEL_FONT}`;
    // The tag as laid out for the card, and, on a tall card, its one-line form (the "Choose" short tag) for a crowded photo.
    const build = (twoLines) => {
      const texts = tagRows(tag, twoLines, textMax, (t) => ctx.measureText(t).width);
      const rows = texts.map((text, i) => ({
        text,
        font: `${texts.length === 2 && i === 0 ? 700 : 800} ${layout.px}px ${LABEL_FONT}`,
        color: texts.length === 2 && i === 0 ? '#f3f4f8' : STATE_TEXT[state],
      }));
      let widest = 0;
      for (const row of rows) {
        ctx.font = row.font;
        widest = Math.max(widest, ctx.measureText(row.text).width);
      }
      if (!rows.some((row) => row.text)) return null;
      return { rows, w: Math.min(Math.ceil(widest) + ACCENT_W + PAD_X * 2, layout.maxWidth), h: PAD_Y * 2 + rows.length * layout.px + GAP * (rows.length - 1) };
    };
    const full = build(layout.lines === 2);
    if (!full) return null;
    const short = layout.lines === 2 ? build(false) : null;
    const variants = short && short.h < full.h ? [full, short] : [full];
    const fit = placeTagLadder(box, variants, taken, { x: clip.x1, y: clip.y1, w: clip.x2 - clip.x1, h: clip.y2 - clip.y1 }, others);
    if (!fit) return null;
    const { rows, w, h } = variants[fit.size];
    const rect = fit.rect;
    // A soft shadow and a thin state-coloured outline keep the tag readable on a busy photo.
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(12,14,20,0.92)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, w, h, 5);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = STATE_COLORS[state];
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rect.x + 0.5, rect.y + 0.5, w - 1, h - 1, 5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = STATE_COLORS[state];
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, ACCENT_W, h, [5, 0, 0, 5]);
    ctx.fill();
    ctx.textBaseline = 'top';
    let cy = rect.y + PAD_Y;
    for (const row of rows) {
      ctx.font = row.font;
      ctx.fillStyle = row.color;
      ctx.fillText(row.text, rect.x + ACCENT_W + PAD_X, cy);
      cy += layout.px + GAP;
    }
    return rect;
  }

  const money = (n) => '$' + Number(n).toFixed(2);

  /** The two lines a card's label shows: its name and one price (or a price range while the set is open). */
  function labelText(card) {
    if (cardState(card) === 'skipped') return { name: 'Skipped', price: 'Not priced. Put it back in the scanner to price it', muted: true };
    if (cardState(card) === 'choose') {
      const guess = guessLine(card.display?.guess);
      const ask = card.display?.highValue ? 'High value, double-check. Tap to pick it in the scanner' : 'Tap to pick it in the scanner';
      return { name: guess || 'Choose a card', price: ask, muted: true };
    }
    if (card.abstain || !card.identity?.name) return { name: 'Not recognised', price: 'Turn it over to identify it', muted: true };
    const disp = card.display || null;
    // A price older than 30 days is never shown (the popup sets `stale`): same rule as no price until trusted.
    if (disp?.stale === true) return { name: card.identity.name, price: 'Old price', muted: true };
    if (disp?.price != null) return { name: card.identity.name, price: money(disp.price) };
    const note = disp?.printingNote || '';
    // The caveat travels with the range: a set that is not sure is never shown as a plain price.
    if (note.includes('$')) {
      const range = note.slice(note.indexOf('$'));
      return { name: card.identity.name, price: range, ...(/set not sure/i.test(note) ? { caveat: 'set not sure' } : {}) };
    }
    const values = Object.values(card.price_grid?.variants || {})
      .map((v) => v?.market)
      .filter((n) => typeof n === 'number' && n > 0);
    if (values.length > 1) return { name: card.identity.name, price: money(Math.min(...values)) + '–' + money(Math.max(...values)) };
    if (card.market_price != null) return { name: card.identity.name, price: money(card.market_price) };
    return { name: card.identity.name, price: '—', muted: true };
  }

  const LABEL_FONT  = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const LABEL_PAD_X = 10;
  const LABEL_PAD_Y = 7;
  const LABEL_ACCENT_W = 3;
  const LABEL_GAP = 3;
  const LABEL_MARGIN = 4;

  /**
   * The label a hovered card opens: its whole name, then its whole price or what to do, at the top of its frame. It
   * may be wider than the card, but stays inside `clip` (the photo's visible rect) and the viewport; text is cut only
   * where that rect is narrower than it. measure(text, font) gives a width in CSS px.
   */
  function labelLayout(box, card, clip, measure) {
    const { name, price: rawPrice, caveat, muted } = labelText(card);
    const price = caveat && rawPrice ? `${caveat} · ${rawPrice}` : rawPrice;
    const NAME_PX = 15;
    const PRICE_PX = muted ? 12 : 17;
    const x1 = Math.max(clip.x1, 0);
    const y1 = Math.max(clip.y1, 0);
    const x2 = Math.min(clip.x2, viewW());
    const y2 = Math.min(clip.y2, viewH());
    const maxW = Math.max(0, x2 - x1 - LABEL_MARGIN * 2);
    const textMax = Math.max(0, maxW - LABEL_ACCENT_W - LABEL_PAD_X * 2);
    const lines = [
      { text: name, font: `600 ${NAME_PX}px ${LABEL_FONT}`, px: NAME_PX, color: '#f3f4f8' },
      { text: price || '—', font: `700 ${PRICE_PX}px ${LABEL_FONT}`, px: PRICE_PX, color: muted ? '#a3a9bf' : '#34d399' },
    ];
    let widest = 0;
    for (const l of lines) {
      l.text = fitText(l.text, textMax, (t) => measure(t, l.font));
      widest = Math.max(widest, measure(l.text, l.font));
    }
    const w = Math.min(Math.ceil(widest) + LABEL_ACCENT_W + LABEL_PAD_X * 2, maxW);
    const h = LABEL_PAD_Y * 2 + lines.reduce((sum, l) => sum + l.px, 0) + LABEL_GAP * (lines.length - 1);
    const x = Math.max(x1 + LABEL_MARGIN, Math.min(box[0] + 4, x2 - w - LABEL_MARGIN));
    const y = Math.max(y1 + LABEL_MARGIN, Math.min(box[1] + 4, y2 - h - LABEL_MARGIN));
    return { lines, x, y, w, h };
  }

  /** Draws a hovered card's label (see labelLayout); returns its rect. */
  function drawLabel(box, card, accentColor, clip) {
    const { lines, x, y, w, h } = labelLayout(box, card, clip, (t, font) => {
      ctx.font = font;
      return ctx.measureText(t).width;
    });

    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(12,14,20,0.96)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.roundRect(x, y, LABEL_ACCENT_W, h, [6, 0, 0, 6]);
    ctx.fill();

    ctx.textBaseline = 'top';
    let cy = y + LABEL_PAD_Y;
    for (const l of lines) {
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x + LABEL_ACCENT_W + LABEL_PAD_X, cy);
      cy += l.px + LABEL_GAP;
    }
    return { x, y, w, h };
  }

  function fitText(text, maxPx, measure) {
    if (measure(text) <= maxPx) return text;
    let end = text.length;
    while (end > 0 && measure(text.slice(0, end) + '…') > maxPx) end--;
    return end > 0 ? text.slice(0, end).trimEnd() + '…' : '';
  }

  // ─── DOM-based card finder ────────────────────────────────────────────────
  // Pokémon card aspect ratio is 2.5 × 3.5 inches → ~0.714 portrait.
  // Accept a wider band (0.55–0.95) to catch borders, protective sleeves,
  // and photos shot with slight rotation. Lower size threshold lets us pick
  // up marketplace thumbnails (HiBid, eBay) that are often ~70×100 px.
  const CARD_RATIO_MIN = 0.55;
  const CARD_RATIO_MAX = 0.95;
  const CARD_MIN_W     = 60;
  const CARD_MIN_H     = 85;

  // Images bigger than this (CSS px) are candidates for "multi-card photo" treatment —
  // run YOLO inside them to find individual cards. Marketplace lot shots and FB
  // Marketplace listings fall here (landscape / square multi-card photos).
  const PHOTO_MIN_SIDE = 180;
  // Box art that says what it sells. A bare "tin", "bundle", "binder" or "playmat" also names cards
  // photographed in one, so those need a sealed context word to count.
  const SEALED_PRODUCT_LABEL = /\b(?:ultra[\s-]*premium collection|premium collection|collection (?:box|chest|set)|booster(?: box| pack| bundle)?|elite trainer box|starter deck|battle deck|gift set|trading card game classic)\b/i;

  function isSealedLabel(text) {
    return SEALED_PRODUCT_LABEL.test(String(text || ''));
  }

  // Only the image's own alt and aria text: a link's visible text names the whole tile, not the picture.
  function hasSealedProductContext(node) {
    const link = node.closest('a');
    const label = [
      node.alt,
      node.getAttribute('aria-label'),
      link?.getAttribute('aria-label'),
    ].filter(Boolean).join(' ');
    return isSealedLabel(label);
  }

  function tidyText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  const MAX_ANCESTORS = 12;

  // Clip a box (viewport px) by the ancestors that really clip this element. chain[0] is the element
  // (position only); the rest are its ancestors, nearest first, as {position, clipX, clipY, root, rect}.
  // body/html never clip; a fixed element is not clipped by ancestors; an absolutely positioned element
  // is only clipped from its containing block outward; the walk stops at a fixed ancestor.
  function clipBox(box, chain) {
    let { x1, y1, x2, y2 } = box;
    const self = chain[0] || {};
    if (self.position === 'fixed') return { x1, y1, x2, y2 };
    let skipping = self.position === 'absolute';
    for (let i = 1; i < chain.length && i <= MAX_ANCESTORS; i++) {
      const a = chain[i];
      if (a.root) break;
      if (skipping) {
        if (a.position === 'static') continue;
        skipping = false;
      }
      if (a.clipX) { x1 = Math.max(x1, a.rect.left); x2 = Math.min(x2, a.rect.right); }
      if (a.clipY) { y1 = Math.max(y1, a.rect.top); y2 = Math.min(y2, a.rect.bottom); }
      if (a.position === 'fixed') break;
      if (a.position === 'absolute') skipping = true;
    }
    return { x1, y1, x2, y2 };
  }

  // What surrounds an image, for the background's page-focus decision: landmarks, aria labels,
  // and the short heading ("Similar items") that sits just before a block of images. Raw
  // strings only; the judging lives in lib/page-focus.js.
  const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  let _headingBefore = new WeakMap();

  // Only the start of an element's text is ever judged (headings are short), so a huge subtree is never joined into one string.
  const TEXT_LIMIT = 200;
  const TEXT_NODE_LIMIT = 200;
  const MAX_TEXT_CHILDREN = 20;
  function boundedText(el) {
    if (!el || el.childElementCount > MAX_TEXT_CHILDREN) return '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    let nodes = 0;
    for (let node = walker.nextNode(); node && text.length < TEXT_LIMIT && nodes < TEXT_NODE_LIMIT; node = walker.nextNode(), nodes++) {
      text += node.nodeValue || '';
    }
    return text.slice(0, TEXT_LIMIT);
  }

  function headingBefore(el) {
    if (_headingBefore.has(el)) return _headingBefore.get(el);
    let found = '';
    let sibling = el.previousElementSibling;
    for (let step = 0; sibling && step < 2 && !found; step++, sibling = sibling.previousElementSibling) {
      const text = tidyText(boundedText(sibling));
      const isHeading = sibling.matches(HEADING_SELECTOR) || sibling.querySelector(HEADING_SELECTOR);
      if (isHeading && text && text.length <= 100 && !sibling.querySelector('img,picture,video')) found = text;
    }
    _headingBefore.set(el, found);
    return found;
  }

  // Stable ids for elements, so the background can ask "is this image inside that section" without
  // the DOM: an element's chain is its own id followed by its ancestors', nearest first.
  const _ids = new WeakMap();
  let _nextId = 1;
  function idOf(el) {
    let id = _ids.get(el);
    if (!id) {
      id = _nextId++;
      _ids.set(el, id);
    }
    return id;
  }
  function chainOf(el) {
    const chain = [];
    for (let p = el; p && chain.length < 80; p = p.parentElement) chain.push(idOf(p));
    return chain;
  }

  // Inside a horizontally scrolling or clipped strip that is wider than what it shows: a carousel.
  let _scrollsX = new WeakMap();

  // Layout and sibling headings are cached while one scan walks the page; the next scan sees the page as it is then.
  function resetScanCaches() {
    _headingBefore = new WeakMap();
    _scrollsX = new WeakMap();
  }
  function scrollsHorizontally(el) {
    let depth = 0;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement && depth < MAX_ANCESTORS; p = p.parentElement, depth++) {
      let scrolls = _scrollsX.get(p);
      if (scrolls === undefined) {
        const overflow = getComputedStyle(p).overflowX;
        scrolls = (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') && p.scrollWidth > p.clientWidth + 1;
        _scrollsX.set(p, scrolls);
      }
      if (scrolls) return true;
    }
    return false;
  }

  const LABELLED_CONTAINERS = new Set(['SECTION', 'ASIDE', 'DIV', 'UL', 'OL', 'NAV', 'ARTICLE']);

  // Short titles of sections: headings and labelled containers, with the chain of the element that carries
  // them. Judging which are "similar items" happens in lib/page-focus.js.
  function collectHeadings() {
    const out = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],section[aria-label],aside[aria-label],div[aria-label],ul[aria-label],ol[aria-label],nav[aria-label],article[aria-label],[role="region"][aria-label]')) {
      if (out.length >= 300) break;
      const label = el.getAttribute('aria-label');
      const heading = /^H[1-6]$/.test(el.tagName) || el.getAttribute('role') === 'heading';
      if (!heading && !(label && LABELLED_CONTAINERS.has(el.tagName))) continue;
      if (heading && !label && el.querySelector('img,picture,video')) continue;
      const text = tidyText(label || boundedText(el));
      if (!text || text.length > 100) continue;
      out.push({ text, chain: chainOf(el) });
    }
    return out;
  }

  // Where the page keeps larger renditions of this image; the background decides which to try.
  const FULL_SIZE_ATTR = /^data-.*(?:zoom|large|full|orig|hi-?res|big|master|lightbox|src)/i;

  function sourceHints(img) {
    const sets = [img.srcset || ''];
    if (img.parentElement?.tagName === 'PICTURE') {
      for (const source of img.parentElement.querySelectorAll('source[srcset]')) sets.push(source.srcset || '');
    }
    const attrs = [];
    for (const attr of img.attributes || []) {
      if (FULL_SIZE_ATTR.test(attr.name) && attr.value && attr.value.length <= 2000 && attrs.length < 6) attrs.push(attr.value);
    }
    return {
      srcset: sets.filter(Boolean).join(', ').slice(0, 6000),
      attrs,
      link: img.closest('a[href]')?.href || '',
    };
  }

  function contextOf(node) {
    const landmarks = [];
    const headings = [];
    const labels = [];
    let depth = 0;
    for (let el = node; el && el !== document.documentElement && depth < 12; el = el.parentElement, depth++) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'main' || tag === 'aside' || tag === 'nav' || tag === 'footer' || tag === 'article') landmarks.push(tag);
      const role = el.getAttribute('role');
      if (role) landmarks.push(role.toLowerCase());
      const label = el.getAttribute('aria-label');
      if (label) labels.push(label.slice(0, 100));
      const heading = headingBefore(el);
      if (heading) headings.push(heading);
    }
    return {
      landmarks, headings, labels, sealedLabel: hasSealedProductContext(node), chain: chainOf(node), hscroll: scrollsHorizontally(node),
      link: node.closest('a[href]')?.href || '',
    };
  }

  // Where the page's pictures link to, on screen or not: tiles of other listings ("Today's picks") tell the
  // background this page is one listing among others.
  const MAX_IMAGE_LINKS = 200;
  function imageLinks() {
    const links = new Set();
    let seen = 0;
    for (const img of document.querySelectorAll('img')) {
      if (seen++ >= MAX_IMAGE_ELEMENTS || links.size >= MAX_IMAGE_LINKS) break;
      const href = img.closest('a[href]')?.href;
      if (href && href.length <= 2000) links.add(href);
    }
    return [...links];
  }

  // Hostnames the page itself loaded pictures from. The background only fetches full-size renditions from these.
  const MAX_IMAGE_HOSTS = 200;
  const MAX_IMAGE_ELEMENTS = 1000;
  const MAX_RESOURCE_ENTRIES = 3000;

  function srcsetUrls(text) {
    const out = [];
    for (const match of String(text || '').matchAll(/(\S+)(?:\s+[\d.]+[wx])?\s*(?:,|$)/g)) out.push(match[1].replace(/,+$/, ''));
    return out;
  }

  function collectImageHosts() {
    const hosts = new Set();
    const add = (raw) => {
      if (!raw || hosts.size >= MAX_IMAGE_HOSTS) return;
      try {
        const host = new URL(raw, document.baseURI).hostname.toLowerCase();
        if (host) hosts.add(host);
      } catch { /* not a URL */ }
    };
    let seen = 0;
    for (const img of document.querySelectorAll('img')) {
      if (seen++ >= MAX_IMAGE_ELEMENTS) break;
      add(img.currentSrc);
      add(img.src);
      srcsetUrls(img.srcset).forEach(add);
    }
    for (const source of document.querySelectorAll('picture source[srcset]')) srcsetUrls(source.srcset).forEach(add);
    if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
      for (const entry of performance.getEntriesByType('resource').slice(0, MAX_RESOURCE_ENTRIES)) {
        if (entry.initiatorType === 'img' || entry.initiatorType === 'css') add(entry.name);
      }
    }
    return [...hosts];
  }

  function metaContent(selector) {
    return document.querySelector(selector)?.getAttribute('content') || '';
  }

  // The last crumb names the page itself; the ones before it are the site's sections and a series.
  function breadcrumbText() {
    // A class like "has-breadcrumb" can sit on the body or a page wrapper; a real trail is short.
    const el = [...document.querySelectorAll('nav[aria-label*="readcrumb" i], .breadcrumb, [class*="breadcrumb" i]')]
      .find((node) => node !== document.body && node !== document.documentElement && (node.textContent || '').length <= 400);
    if (!el) return '';
    const items = [...el.querySelectorAll('li')].map((li) => (li.textContent || '').trim()).filter(Boolean);
    const crumbs = items.length ? items : (el.textContent || '').split(/[>›»/|]/).map((t) => t.trim()).filter(Boolean);
    return (crumbs[crumbs.length - 1] || '').slice(0, 200);
  }

  // What the page says it is about: used to recognise the listing photo and sealed products.
  function pageInfo() {
    const ogImages = [
      metaContent('meta[property="og:image"]'),
      metaContent('meta[property="og:image:secure_url"]'),
      metaContent('meta[name="twitter:image"]'),
      document.querySelector('link[rel="image_src"]')?.getAttribute('href') || '',
    ].filter(Boolean).map((url) => {
      try { return new URL(url, document.baseURI).href; } catch { return ''; }
    }).filter(Boolean);
    return {
      title: (document.title || '').slice(0, 200),
      ogTitle: metaContent('meta[property="og:title"]').slice(0, 200),
      h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 200),
      breadcrumb: breadcrumbText(),
      ogImages,
      headings: collectHeadings(),
      imageHosts: collectImageHosts(),
      imageLinks: imageLinks(),
    };
  }

  // A Facebook listing fetched without cookies names its cover photo's upload in og:image, which the logged-in page
  // lacks. Only a scan asks (never on page load), for this page's own origin; the head's text goes back to the
  // background, which keeps the image URLs and drops the rest. Anything unexpected answers '' (no upgrade).
  const SHARE_FETCH_MS = 4000;
  const SHARE_MAX_BYTES = 1.5 * 1024 * 1024;

  async function sharePageHead(raw) {
    let url;
    try {
      url = new URL(raw);
      if (url.origin !== new URL(document.baseURI).origin) return '';
    } catch {
      return '';
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SHARE_FETCH_MS);
    try {
      const res = await fetch(url.href, { credentials: 'omit', signal: abort.signal, headers: { Accept: 'text/html' } });
      if (!res.ok || new URL(res.url || url.href).origin !== url.origin) return '';
      if (!/text\/html/i.test(res.headers.get('content-type') || '')) return '';
      if (Number(res.headers.get('content-length')) > SHARE_MAX_BYTES) return '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return text;
        bytes += value.byteLength;
        if (bytes > SHARE_MAX_BYTES) {
          reader.cancel().catch(() => {});
          return '';
        }
        text += decoder.decode(value, { stream: true });
        const end = text.search(/<\/head>/i);
        if (end >= 0) {
          reader.cancel().catch(() => {});
          return text.slice(0, end);
        }
      }
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  // The part of an image that is actually on screen: inside the viewport and inside the ancestors that
  // clip it. A carousel slide pushed out of an overflow:hidden strip has a layout box and nothing to see.
  function visibleBox(el, r) {
    const viewport = {
      x1: Math.max(0, r.left), y1: Math.max(0, r.top),
      x2: Math.min(window.innerWidth, r.right), y2: Math.min(window.innerHeight, r.bottom),
    };
    const pvw = Math.max(0, viewport.x2 - viewport.x1);
    const pvh = Math.max(0, viewport.y2 - viewport.y1);
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      return { vx: viewport.x1, vy: viewport.y1, vw: 0, vh: 0, pvw, pvh };
    }
    const chain = [{ position: getComputedStyle(el).position }];
    let depth = 0;
    for (let p = el.parentElement; p && depth < MAX_ANCESTORS; p = p.parentElement, depth++) {
      const root = p === document.body || p === document.documentElement;
      const style = getComputedStyle(p);
      const clipX = style.overflowX !== 'visible';
      const clipY = style.overflowY !== 'visible';
      chain.push({
        position: style.position, clipX, clipY, root,
        rect: clipX || clipY ? p.getBoundingClientRect() : null,
      });
      if (root) break;
    }
    const c = clipBox(viewport, chain);
    return { vx: c.x1, vy: c.y1, vw: Math.max(0, c.x2 - c.x1), vh: Math.max(0, c.y2 - c.y1), pvw, pvh };
  }

  function snapshotRect(r) {
    return { left: r.left + window.scrollX, top: r.top + window.scrollY, right: r.right + window.scrollX, bottom: r.bottom + window.scrollY };
  }

  // The same element keeps its id across screens, so the background can tell a card seen twice.
  // The picture it showed is kept too: a carousel that swaps it later must not carry this scan's boxes.
  function registerAnchor(el, r) {
    const rect = snapshotRect(r);
    const source = sourceOf(el);
    // Also compute and store the painted rect (in document coordinates) for letterboxed images
    let paintedRect = null;
    if (el.tagName === 'IMG') {
      const style = getComputedStyle(el);
      const painted = paintedBox(r, el.naturalWidth, el.naturalHeight, style.objectFit || 'fill', style.objectPosition || '50% 50%');
      if (painted) {
        paintedRect = snapshotRect(painted);
      }
    }
    const known = _anchorIds.get(el);
    if (known !== undefined) {
      Object.assign(_scanAnchors[known], { rect, source, paintedRect });
      return known;
    }
    _anchorIds.set(el, _scanAnchors.length);
    _scanAnchors.push({ el, rect, source, paintedRect });
    return _scanAnchors.length - 1;
  }

  // ─── Decorative copies of a photo ─────────────────────────────────────────
  // Some sites paint the listing picture twice with the same src: the sharp <img> and a blurred, scaled-up copy
  // behind it (Facebook Marketplace's backdrop is a blur(2px) copy under matrix(11,0,0,11,0,0), painted far larger
  // than the picture). Only the sharp one is the photo: boxes found in it must be mapped through its own rect.
  // An <img> is decorative when it or an ancestor is blurred, when an ancestor transform paints it much larger
  // than its layout size, or when it lies fully behind another, non-decorative <img> of the same src.
  const DECORATIVE_INFLATION = 1.5; // painted / layout size; a 45 degree tilt grows a box 1.41x, a hover zoom about 1.1-1.2x
  const EDGE_SLACK = 1;             // px

  // True when a CSS filter value contains a blur with a radius above zero.
  function hasBlur(filter) {
    const blur = /blur\(\s*([\d.]+)/i.exec(typeof filter === 'string' ? filter : '');
    return blur !== null && parseFloat(blur[1]) > 0;
  }

  // Why this image is a decorative copy, or null. rect is the painted size (getBoundingClientRect), layoutW/H the
  // size before any transform (offsetWidth/Height; 0 when unknown, which never counts as inflated).
  function decorativeReason({ rect, layoutW, layoutH, blurred, behindDuplicate }) {
    if (blurred) return 'blurred';
    if ((layoutW > 0 && rect.w > layoutW * DECORATIVE_INFLATION) || (layoutH > 0 && rect.h > layoutH * DECORATIVE_INFLATION)) return 'inflated';
    if (behindDuplicate) return 'behind-duplicate';
    return null;
  }

  function isBlurred(el) {
    for (let node = el; node && node.nodeType !== 9; node = node.parentElement) {
      if (hasBlur(getComputedStyle(node).filter)) return true;
    }
    return false;
  }

  function sameSrcImages(img, src, imgs) {
    return src ? Array.prototype.filter.call(imgs, (other) => other !== img && (other.currentSrc || other.src || '') === src) : [];
  }

  function rectInside(inner, outer) {
    return inner.left >= outer.left - EDGE_SLACK && inner.top >= outer.top - EDGE_SLACK
      && inner.right <= outer.right + EDGE_SLACK && inner.bottom <= outer.bottom + EDGE_SLACK;
  }

  // Another sharp copy of the same src lies inside this image's rect and is painted above it.
  function hiddenBehindCopy(img, r, copies) {
    if (!copies.length || typeof document.elementsFromPoint !== 'function') return false;
    for (const other of copies) {
      const o = other.getBoundingClientRect();
      if (!(o.width > 0 && o.height > 0) || !rectInside(o, r)) continue;
      if (decorativeReason({ rect: { w: o.width, h: o.height }, layoutW: other.offsetWidth, layoutH: other.offsetHeight, blurred: isBlurred(other) })) continue;
      const stack = document.elementsFromPoint((o.left + o.right) / 2, (o.top + o.bottom) / 2);
      const above = stack.indexOf(other);
      const below = stack.indexOf(img);
      if (above >= 0 && below >= 0 && above < below) return true;
    }
    return false;
  }

  // null for a photo worth scanning; otherwise why not. Called only for images already big enough and on screen.
  function decorativeOf(img, r, imgs) {
    const src = img.currentSrc || img.src || '';
    const copies = sameSrcImages(img, src, imgs);
    return decorativeReason({
      rect: { w: r.width, h: r.height },
      layoutW: img.offsetWidth || 0,
      layoutH: img.offsetHeight || 0,
      blurred: isBlurred(img),
      behindDuplicate: hiddenBehindCopy(img, r, copies),
    });
  }

  function findCardImages(opts = {}) {
    resetScanCaches();
    if (!opts.keepAnchors) {
      _scanAnchors = [];
      _anchorIds = new Map();
    }
    _scanScroll = { x: window.scrollX, y: window.scrollY };
    _scanView = { w: window.innerWidth, h: window.innerHeight };
    const found = [];
    const photos = [];  // large non-card-aspect images for YOLO-inside-image treatment
    const rejected = []; // only populated when opts.diag === true
    const seen  = new Set();
    const imgs  = document.querySelectorAll('img');
    let pending = 0; // card-shaped pictures that have not finished loading yet

    const bgCandidates = scanBackgroundImages();

    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      const ratio = r.height ? r.width / r.height : 0;
      const src = img.currentSrc || img.src || '';

      const cardShaped = r.width >= CARD_MIN_W && r.height >= CARD_MIN_H
        && ratio >= CARD_RATIO_MIN && ratio <= CARD_RATIO_MAX
        && r.right > 0 && r.bottom > 0
        && r.left < window.innerWidth && r.top < window.innerHeight;
      // Layout is already card-sized, but the bytes have not arrived. A finished
      // image with no pixels is broken, not "still loading".
      if (!img.complete && cardShaped) pending += 1;

      let reason = null;
      let decorative = null;
      if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) reason = 'not-loaded';
      else if (r.width < CARD_MIN_W || r.height < CARD_MIN_H)                  reason = 'too-small';
      else if (r.right <= 0 || r.bottom <= 0 ||
               r.left >= window.innerWidth || r.top >= window.innerHeight)     reason = 'off-screen';
      else if ((decorative = decorativeOf(img, r, imgs)) !== null)             reason = 'decorative';
      else if (ratio < CARD_RATIO_MIN || ratio > CARD_RATIO_MAX)               reason = 'wrong-ratio';
      else if (hasSealedProductContext(img))                                    reason = 'sealed-product';

      // Rect visible within the viewport and every overflow-clipping ancestor. Skipped for images
      // already rejected as unloaded, tiny or off-screen: they are never scanned.
      // A decorative copy is never pinned to by the overlay either: its rect is not where the picture is.
      const anchor = r.width >= CARD_MIN_W && r.height >= CARD_MIN_H && reason !== 'decorative' ? registerAnchor(img, r) : undefined;
      const gone = reason === 'not-loaded' || reason === 'too-small' || reason === 'off-screen' || reason === 'decorative';
      const { vx, vy, vw, vh, pvw, pvh } = gone ? { vx: 0, vy: 0, vw: 0, vh: 0, pvw: 0, pvh: 0 } : visibleBox(img, r);
      const visibleCoverage = r.width > 0 && r.height > 0
        ? (vw * vh) / (r.width * r.height)
        : 0;
      if (!reason && visibleCoverage < 0.75) reason = 'mostly-clipped';

      // Treat ANY sufficiently-large loaded image as a photo candidate too — YOLO
      // runs inside it to find individual cards. Multi-card photos (lot shots,
      // lightbox-expanded listing photos) match here regardless of aspect ratio.
      const isLargePhoto = img.complete && img.naturalWidth > 0 &&
        pvw >= PHOTO_MIN_SIDE && pvh >= PHOTO_MIN_SIDE;

      if (reason) {
        if (opts.diag) rejected.push({ reason, ...(decorative ? { decorative } : {}), src: src.slice(0, 160), w: Math.round(r.width), h: Math.round(r.height), ratio: Number(ratio.toFixed(3)) });
        // A sealed product's box art is kept as a photo candidate too, so the background can see that
        // the listing's main picture is a product and not a card; it never scans it for cards.
        if ((reason === 'wrong-ratio' || reason === 'sealed-product') && isLargePhoto) {
          const key = 'p:' + src + ':' + Math.round(r.left) + ':' + Math.round(r.top);
          if (!seen.has(key)) {
            seen.add(key);
            const style = getComputedStyle(img);
            photos.push({
              rect: { x: r.left, y: r.top, w: r.width, h: r.height, vx, vy, vw, vh, pvw, pvh },
              naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
              src: img.currentSrc || img.src || '',
              render: { fit: style.objectFit || 'fill', position: style.objectPosition || '50% 50%' },
              ctx: contextOf(img),
              sources: sourceHints(img),
            });
          }
        }
        continue;
      }
      const key = src + ':' + Math.round(r.left) + ':' + Math.round(r.top);
      if (seen.has(key)) continue;
      seen.add(key);
      const imageStyle = getComputedStyle(img);
      found.push({
        anchor,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height, vx, vy, vw, vh, pvw, pvh },
        naturalWidth:  img.naturalWidth,
        naturalHeight: img.naturalHeight,
        src: img.currentSrc || img.src || '',
        render: { fit: imageStyle.objectFit || 'fill', position: imageStyle.objectPosition || '50% 50%' },
        ctx: contextOf(img),
      });
      // ALSO add big card-shaped images to the photos list, so a single large
      // image that actually contains multiple cards (e.g. a stack photo cropped
      // tall) can be split by YOLO. The background prefers YOLO hits when ≥ 2.
      if (pvw >= PHOTO_MIN_SIDE && pvh >= PHOTO_MIN_SIDE) {
        const pkey = 'p:' + src + ':' + Math.round(r.left) + ':' + Math.round(r.top);
        if (!seen.has(pkey)) {
          seen.add(pkey);
          photos.push({
            rect: { x: r.left, y: r.top, w: r.width, h: r.height, vx, vy, vw, vh, pvw, pvh },
            naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
            src: img.currentSrc || img.src || '',
            render: { fit: imageStyle.objectFit || 'fill', position: imageStyle.objectPosition || '50% 50%' },
            ctx: contextOf(img),
            sources: sourceHints(img),
          });
        }
      }
    }

    for (const candidate of bgCandidates) {
      const { rect, ratio } = candidate;
      const key = 'bg:' + candidate.bg + ':' + Math.round(rect.x) + ':' + Math.round(rect.y);
      if (ratio >= CARD_RATIO_MIN && ratio <= CARD_RATIO_MAX && !seen.has(key)) {
        seen.add(key);
        found.push({ anchor: candidate.anchor, rect, naturalWidth: null, naturalHeight: null, ctx: candidate.ctx });
      }
      if (rect.vw >= PHOTO_MIN_SIDE && rect.vh >= PHOTO_MIN_SIDE) {
        const photoKey = 'bgp:' + candidate.bg + ':' + Math.round(rect.x) + ':' + Math.round(rect.y);
        if (!seen.has(photoKey)) {
          seen.add(photoKey);
          photos.push({
            rect,
            naturalWidth: null,
            naturalHeight: null,
            src: candidate.src,
            render: { fit: 'background', size: candidate.size, position: candidate.position, repeat: candidate.repeat },
            ctx: candidate.ctx,
          });
        }
      }
    }
    return { cards: found, photos, pending, rejected, bgCandidates, totalImgs: imgs.length };
  }

  // The small pictures of a page (a listing's thumbnail strip): the background keeps the ones that belong to the
  // listing's own gallery and reads their source images. Large ones are already photo candidates.
  const THUMB_MIN_SIDE = 32;
  const MAX_THUMBS = 80;
  function galleryThumbnails() {
    const out = [];
    for (const img of document.querySelectorAll('img')) {
      if (out.length >= MAX_THUMBS) break;
      const src = img.currentSrc || img.src || '';
      if (!/^https?:/i.test(src) || !img.complete || !(img.naturalWidth > 0)) continue;
      const r = img.getBoundingClientRect();
      if (r.width < THUMB_MIN_SIDE || r.height < THUMB_MIN_SIDE) continue;
      if (r.width >= PHOTO_MIN_SIDE && r.height >= PHOTO_MIN_SIDE) continue;
      const style = getComputedStyle(img);
      out.push({
        rect: { x: r.left, y: r.top, w: r.width, h: r.height, vx: 0, vy: 0, vw: 0, vh: 0, pvw: r.width, pvh: r.height },
        naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        src,
        render: { fit: style.objectFit || 'fill', position: style.objectPosition || '50% 50%' },
        ctx: contextOf(img),
        sources: sourceHints(img),
        thumb: true,
      });
    }
    return out;
  }

  // Scan for card-sized elements that use CSS background-image instead of <img>.
  // These are a common failure mode on image viewers (Facebook, HiBid lightboxes).
  function scanBackgroundImages() {
    const out = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    let n = 0;
    while (node && n < 2000) {
      if (node.nodeType === 1) {
        const r = node.getBoundingClientRect();
        if (r.width >= CARD_MIN_W && r.height >= CARD_MIN_H &&
            r.right > 0 && r.bottom > 0 &&
            r.left < window.innerWidth && r.top < window.innerHeight) {
          const vx = Math.max(0, r.left);
          const vy = Math.max(0, r.top);
          const vw = Math.min(window.innerWidth, r.right) - vx;
          const vh = Math.min(window.innerHeight, r.bottom) - vy;
          const visibleCoverage = (vw * vh) / (r.width * r.height);
          if (visibleCoverage >= 0.75) {
            const style = getComputedStyle(node);
            const bg = style.backgroundImage;
            if (style.visibility !== 'hidden' && style.display !== 'none' &&
                style.opacity !== '0' && bg && bg !== 'none' && bg.includes('url(') &&
                !hasSealedProductContext(node)) {
              const ratio = r.width / r.height;
              const urlMatch = bg.match(/url\((?:\s*["']?)(.*?)(?:["']?\s*)\)/i);
              let src = '';
              try { src = urlMatch ? new URL(urlMatch[1], document.baseURI).href : ''; } catch { /* unsupported URL */ }
              const anchor = registerAnchor(node, r);
              out.push({
                anchor,
                rect: { x: r.left, y: r.top, w: r.width, h: r.height, vx, vy, vw, vh },
                w: Math.round(r.width), h: Math.round(r.height), ratio: Number(ratio.toFixed(3)),
                tag: node.tagName, bg: bg.slice(0, 120),
                ctx: contextOf(node),
                src,
                size: style.backgroundSize,
                position: style.backgroundPosition,
                repeat: style.backgroundRepeat,
              });
            }
          }
        }
        n++;
      }
      node = walker.nextNode();
    }
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'showOverlay') {
      _fullSize = msg.fullSize?.url && /^https?:/.test(msg.fullSize.url) ? { url: msg.fullSize.url } : null;
      if (typeof msg.shown === 'boolean') _shown = msg.shown;
      renderOverlay(msg.cards, msg.srcWidth, msg.srcHeight);
    } else if (msg.action === 'setOverlayShown') {
      setOverlayShown(msg.shown !== false);
    } else if (msg.action === 'hideOverlay') {
      hideOverlay(() => sendResponse({ hidden: true }));
      return true;
    } else if (msg.action === 'scrollTo') {
      scrollToAndSettle(msg.x, msg.y, (at) => sendResponse(at));
      return true;
    } else if (msg.action === 'restoreOverlay') {
      restoreOverlay();
    } else if (msg.action === 'clearOverlay') {
      clearOverlay();
    } else if (msg.action === 'highlightCard') {
      highlightCard(msg.index, msg.scroll === true);
    } else if (msg.action === 'findCards') {
      const { cards, photos, pending } = findCardImages({ keepAnchors: msg.keepAnchors === true });
      sendResponse({
        cards,
        photos,
        pending,
        thumbs: msg.thumbs === true ? galleryThumbnails() : [],
        documentHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        page: pageInfo(),
        viewportWidth:  window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      return false;
    } else if (msg.action === 'sharePageHead') {
      sharePageHead(msg.url).then((html) => sendResponse({ html }));
      return true;
    } else if (msg.action === 'stopObserving') {
      stopObserving();
    } else if (msg.action === 'startObserving') {
      startObserving();
    // dev-only:start
    } else if (msg.action === 'findCardsDiag') {
      const diag = findCardImages({ diag: true });
      sendResponse({
        ...diag,
        viewportWidth:  window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      return false;
    // dev-only:end
    }
  });

  // dev-only:start
  // Exposed for Playwright demo / testing without going through the relay chain
  window.__cardScanner = { show: renderOverlay, clear: clearOverlay, find: findCardImages, startObserving, stopObserving, pure: { acceptClick, labelText, tagText, tagRows, fitPrice, fitName, tagLayout, placeTag, placeTagLadder, cardState, fitText, labelLayout, paintedBox, hoveredTarget, boxToRel, relToBox, boxToDoc, docToBox, pickAnchor, boxInView, hasBlur, decorativeReason, canvasBacking, tidyText, clipBox, isSealedLabel, chainOf, idOf, sourceHints, boundedText, headingBefore, collectHeadings, scrollsHorizontally, collectImageHosts, srcsetUrls } };
  // dev-only:end
}());
