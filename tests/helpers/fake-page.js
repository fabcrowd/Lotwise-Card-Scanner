// A small fake page for running content.js (a classic script) in node:vm: elements with mutable rects, a window
// whose resize/scroll listeners and animation frames the test drives, observers the test can fire, and a 2D
// context that records what was drawn and how much of it the active clip lets through.
import fs from 'node:fs';
import vm from 'node:vm';

export const rectOf = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y });

const BASE_STYLE = {
  position: 'static', overflowX: 'visible', overflowY: 'visible', filter: 'none', transform: 'none',
  objectFit: 'fill', objectPosition: '50% 50%', backgroundImage: 'none', visibility: 'visible', display: 'block', opacity: '1',
};

export function makeNode(tagName, parentElement, style = {}, rect = rectOf(0, 0, 0, 0), extra = {}) {
  return {
    tagName, parentElement, style: { ...BASE_STYLE, ...style }, rect, attrs: {}, isConnected: true,
    previousElementSibling: null, childElementCount: 0, attributes: [], srcset: '', scrollWidth: 0, clientWidth: 0,
    getBoundingClientRect() { return this.rect; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    closest(selector) {
      if (!/^a(\[href\])?$/.test(selector)) return null;
      for (let node = this; node; node = node.parentElement) {
        if (node.tagName === 'A' && (selector === 'a' || node.attrs.href)) return node;
      }
      return null;
    },
    matches() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains(other) {
      for (let node = other; node; node = node.parentElement) if (node === this) return true;
      return false;
    },
    ...extra,
  };
}

const intersect = (a, b) => {
  const r = { x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) };
  return r.x2 > r.x1 && r.y2 > r.y1 ? r : null;
};

/** A 2D context that records every stroke, fill and text with the part of it the clip lets through (`seen`). */
export function recorder() {
  const ops = [];
  const stack = [];
  let clip = null;
  let path = [];
  const record = (kind, rect, extra = {}) => ops.push({ kind, rect, seen: clip ? intersect(rect, clip) : rect, ...extra });
  const box = (x, y, w, h) => ({ x1: x, y1: y, x2: x + w, y2: y + h });
  const grow = (r, by) => ({ x1: r.x1 - by, y1: r.y1 - by, x2: r.x2 + by, y2: r.y2 + by });
  const ctx = {
    lineWidth: 1, strokeStyle: '', fillStyle: '', font: '13px x', globalAlpha: 1, shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    textBaseline: 'top',
    setTransform() {},
    setLineDash() {},
    clearRect() { ops.length = 0; },
    save() { stack.push(clip); },
    restore() { clip = stack.length ? stack.pop() : null; },
    beginPath() { path = []; },
    rect(x, y, w, h) { path.push(box(x, y, w, h)); },
    roundRect(x, y, w, h) { path.push(box(x, y, w, h)); },
    clip() {
      const bounds = path.reduce((a, r) => ({ x1: Math.min(a.x1, r.x1), y1: Math.min(a.y1, r.y1), x2: Math.max(a.x2, r.x2), y2: Math.max(a.y2, r.y2) }),
        { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
      clip = clip ? (intersect(clip, bounds) || { x1: 0, y1: 0, x2: 0, y2: 0 }) : bounds;
    },
    stroke() { for (const r of path) record('stroke', grow(r, ctx.lineWidth / 2), { lineWidth: ctx.lineWidth, alpha: ctx.globalAlpha, raw: r }); },
    fill() { for (const r of path) record('fill', r); },
    fillRect(x, y, w, h) { record('fill', box(x, y, w, h)); },
    strokeRect(x, y, w, h) { record('stroke', grow(box(x, y, w, h), ctx.lineWidth / 2), { lineWidth: ctx.lineWidth, raw: box(x, y, w, h) }); },
    fillText(text, x, y) { record('text', box(x, y, String(text).length * 7, 16), { text: String(text) }); },
    measureText(text) { return { width: String(text).length * 7 }; },
  };
  return {
    ctx,
    ops,
    /** Card frames drawn and not clipped away: drawFrame's 1 px state-coloured outline at 35% opacity (one per card). */
    frames: () => ops.filter((o) => o.kind === 'stroke' && o.lineWidth === 1 && Math.abs(o.alpha - 0.35) < 1e-9 && o.seen).map((o) => o.raw),
    texts: () => ops.filter((o) => o.kind === 'text' && o.seen).map((o) => o.text),
    visible: () => ops.filter((o) => o.seen),
  };
}

/**
 * content.js running against a fake page.
 * @param {{viewport?: {w: number, h: number}, clientWidth?: number, url?: string, globals?: object, storage?: object}} [options]
 *   globals: extra script globals (fetch, setTimeout, AbortController, ...) for code paths that need them
 *   storage: an object that backs chrome.storage.local (read and written by the content script); omit for no storage
 */
export function loadPage({ viewport = { w: 2504, h: 1287 }, clientWidth = 2489, url = 'https://www.facebook.com/marketplace/item/1752834219639617/', globals = {}, storage = null } = {}) {
  const source = fs.readFileSync(new URL('../../tools/extension-wasm/content.js', import.meta.url), 'utf8');
  const view = { cssW: clientWidth, h: viewport.h };
  const html = makeNode('HTML', null, {}, rectOf(0, 0, clientWidth, viewport.h));
  const body = makeNode('BODY', html, {}, rectOf(0, 0, clientWidth, viewport.h));
  const imgs = [];
  const listeners = {};
  const frames = [];
  const rec = recorder();
  const observers = { mutation: [], resize: [] };
  let stackAt = () => [];

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; observers.mutation.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.targets = []; }
    takeRecords() { return []; }
  }
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.elements = new Set(); observers.resize.push(this); }
    observe(el) { this.elements.add(el); }
    unobserve(el) { this.elements.delete(el); }
    disconnect() { this.elements.clear(); }
  }

  const document = {
    documentElement: Object.assign(html, { clientWidth, clientHeight: viewport.h, scrollHeight: viewport.h, appendChild(node) { node.isConnected = true; } }),
    body,
    title: 'Listing',
    baseURI: url,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === 'img' ? imgs : []),
    // Walks the root's `textNodes` (or its textContent as one node); the page itself has none.
    createTreeWalker: (root) => {
      const nodes = root?.textNodes ?? (root?.textContent ? [{ nodeValue: root.textContent }] : []);
      let at = 0;
      return { currentNode: null, nextNode() { this.currentNode = at < nodes.length ? nodes[at++] : null; return this.currentNode; } };
    },
    elementsFromPoint: (x, y) => stackAt(x, y),
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(), style: {}, width: 0, height: 0, isConnected: false,
        getBoundingClientRect: () => rectOf(0, 0, view.cssW, view.h),
        getContext: () => rec.ctx,
        children: [],
        append(...nodes) { for (const n of nodes) this.appendChild(n); },
        appendChild(node) { node.isConnected = true; this.children.push(node); return node; },
        remove() { this.isConnected = false; for (const c of this.children) c.remove(); },
      };
    },
  };
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    innerWidth: viewport.w, innerHeight: viewport.h, devicePixelRatio: 1, scrollX: 0, scrollY: 0,
    ResizeObserver: FakeResizeObserver,
  };
  let listener = null;
  const sent = [];
  const chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, sendMessage: (msg) => { sent.push(msg); return Promise.resolve(); } } };
  // A page with no `storage` option has no chrome.storage at all, as a page where the extension may not use it.
  if (storage) {
    chrome.storage = { local: {
      get: async (key) => (typeof key === 'string' ? { [key]: storage[key] } : { ...storage }),
      set: async (values) => { Object.assign(storage, values); },
    } };
  }
  vm.runInNewContext(source, {
    window, document, chrome, MutationObserver: FakeMutationObserver, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    getComputedStyle: (el) => el.style, URL, Map, WeakMap, Set, ...globals,
  });

  return {
    window, document, body, imgs, rec, observers,
    /** Messages content.js sent to the extension (chrome.runtime.sendMessage). */
    sent,
    send(msg) {
      let reply;
      listener(msg, null, (r) => { reply = r; });
      return reply;
    },
    /** For a handler that answers later (returns true): resolves with its reply, or undefined when it never answers. */
    sendAsync(msg) {
      return new Promise((resolve) => {
        const async = listener(msg, null, resolve);
        if (async !== true) resolve(undefined);
      });
    },
    /** Runs queued animation frames (and the ones they queue) up to a limit; returns how many ran. */
    flush(limit = 500) {
      let ran = 0;
      while (frames.length && ran < limit) { frames.shift()(); ran++; }
      return ran;
    },
    frame() { const fn = frames.shift(); if (fn) fn(); },
    fire(type, event = {}) { for (const fn of [...(listeners[type] || [])]) fn({ type, ...event }); },
    resizeWindow(w, h, cssW) { window.innerWidth = w; window.innerHeight = h; view.cssW = cssW; view.h = h; },
    stack(fn) { stackAt = fn; },
    addImg(parent, rect, { src, natural = [960, 720], alt = '' } = {}) {
      const img = makeNode('IMG', parent, {}, rect, {
        complete: true, naturalWidth: natural[0], naturalHeight: natural[1], currentSrc: src, src, alt,
        offsetWidth: rect.width, offsetHeight: rect.height,
      });
      img.attrs.src = src;
      imgs.push(img);
      return img;
    },
  };
}
