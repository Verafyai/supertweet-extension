// The Supertweet bubble and drawer: one per page, for the composer you're working in. A logo
// bubble (bottom-right, draggable) shows the score and gate color; clicking it opens a full-height
// drawer on the right edge that scrolls inside, with the Post button pinned at the bottom.
// Shadow DOM, so the site's React tree is never touched. Also small DOM helpers.
(() => {
  'use strict';

  // Bubble + drawer chrome only. Everything inside the drawer is the score panel (src/panel.js).
  const CSS = `
    :host { all: initial; }
    .bubble { position: fixed; z-index: 2147483001; width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer; padding: 0; box-sizing: border-box;
      background: #2F45C4; color: #fff; box-shadow: 0 8px 22px rgba(0,0,0,.3); display: grid; place-items: center; touch-action: none;
      outline: 3px solid transparent; outline-offset: 2px; font: 800 13px "Bricolage Grotesque", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .bubble[hidden] { display: none; }
    .bubble svg { width: 28px; height: 28px; }
    .bubble .score { position: absolute; right: -6px; top: -6px; min-width: 26px; height: 22px; padding: 0 6px; border-radius: 999px; background: #141B26; color: #fff; font-size: 12px; line-height: 18px; text-align: center; border: 2px solid #fff; }
    .bubble .score:empty { display: none; }
    .bubble.green { outline-color: #3FD8A0; } .bubble.amber { outline-color: #E3A848; } .bubble.red { outline-color: #EF7A71; } .bubble.neutral { outline-color: transparent; }
    .p { position: fixed; z-index: 2147483000; top: 12px; right: 12px; width: 440px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; border-radius: 16px; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
    .p[hidden] { display: none; }
    .p.flash { animation: f .5s ease 2; }
    @keyframes f { 50% { box-shadow: 0 0 0 3px #EF7A71; } }
    @media (max-width: 520px) { .p { top: 0; right: 0; width: 100vw; max-width: 100vw; max-height: 100vh; border-radius: 0; } }
  `;

  const LOGO = '<svg viewBox="0 0 128 128" aria-hidden="true"><path d="M36 10 H92 A26 26 0 0 1 118 36 V76 A26 26 0 0 1 92 102 H56 L30 122 L33 102 A26 26 0 0 1 10 76 V36 A26 26 0 0 1 36 10 Z" fill="#fff" opacity=".18"/><path d="M44.91 77.09 A27 27 0 1 1 83.09 77.09" fill="none" stroke="#3FD8A0" stroke-width="11" stroke-linecap="round"/><circle cx="64" cy="58" r="7" fill="#fff"/></svg>';
  const KEY = 'supertweet:panel';
  let panel = null;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
  const save = (st) => { try { localStorage.setItem(KEY, JSON.stringify({ open: st.open, bx: st.bx, by: st.by })); } catch { /* private mode */ } };

  function create() {
    const host = document.createElement('div');
    host.setAttribute('data-supertweet', 'panel');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}${globalThis.SupertweetPanel.CSS}</style>
      <button type="button" class="bubble neutral" aria-label="Open Supertweet" aria-expanded="false" title="Supertweet (drag to move)" hidden>${LOGO}<span class="score"></span></button>
      <aside class="p st-scope" role="dialog" aria-label="Supertweet" hidden></aside>`;
    document.documentElement.appendChild(host);
    loadFonts();
    const box = root.querySelector('.p');
    const bubble = root.querySelector('.bubble');
    const saved = load();
    const st = { open: saved.open ?? false, bx: saved.bx ?? null, by: saved.by ?? null };
    panel = { host, root, box, bubble, mount: box, bscore: bubble.querySelector('.score'), st, visible: false };

    // Bubble: click toggles the drawer; drag moves it.
    let drag = null, moved = false;
    bubble.addEventListener('pointerdown', (e) => { const r = bubble.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY }; moved = false; try { bubble.setPointerCapture(e.pointerId); } catch { /* synthetic */ } });
    bubble.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 5) moved = true;
      if (!moved) return;
      st.bx = e.clientX - drag.dx; st.by = e.clientY - drag.dy; place();
    });
    bubble.addEventListener('pointerup', () => { if (drag && moved) save(st); drag = null; });
    bubble.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; return; } st.open = !st.open; save(st); apply(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.open && panel.visible) { st.open = false; save(st); apply(); } });
    // On resize the composer moves: forget its old position and wait for content.js to re-measure.
    addEventListener('resize', () => { mode = null; card = null; setShift(0); place(); });
    apply();
    return panel;
  }

  // Bubble stays on screen; default bottom-right.
  function place() {
    if (!panel) return;
    const { bubble, st } = panel;
    let x = st.bx ?? innerWidth - 56 - 20, y = st.by ?? innerHeight - 56 - 24;
    x = Math.max(8, Math.min(x, innerWidth - 64));
    y = Math.max(8, Math.min(y, innerHeight - 64));
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
  }

  function apply() {
    const { box, bubble, st, visible } = panel;
    box.hidden = !visible || !st.open;
    bubble.hidden = !visible || st.open;
    bubble.setAttribute('aria-expanded', String(st.open));
    if (box.hidden) setShift(0);
    else layoutDrawer();
    requestAnimationFrame(place);
  }

  // ---------- Docking: the drawer never covers the composer ----------
  // Beside the composer card (right side, else left), narrowed to fit (min 320px). If neither side
  // has room, the page's column is shifted left by the drawer's width instead. The choice only
  // changes on resize or reopen, so shifting can't make it flip back and forth.
  const MIN_W = 320, MAX_W = 440, GAP = 16, EDGE = 12;
  let card = null; // the composer card's rect (from content.js)
  let mode = null; // { key, kind: 'right'|'left'|'shift'|'overlay', left, width }
  let shiftStyle = null;
  function setShift(px) {
    const root = document.documentElement;
    if (!px) { if (root.hasAttribute('data-supertweet-shift')) { root.removeAttribute('data-supertweet-shift'); root.style.removeProperty('--supertweet-shift'); } return; }
    if (!shiftStyle) {
      shiftStyle = document.createElement('style');
      shiftStyle.textContent = 'html[data-supertweet-shift] { padding-right: var(--supertweet-shift) !important; box-sizing: border-box !important; }';
      (document.head || document.documentElement).appendChild(shiftStyle);
    }
    root.setAttribute('data-supertweet-shift', '1');
    root.style.setProperty('--supertweet-shift', `${px}px`);
  }
  function decide(r) {
    const right = innerWidth - r.right - GAP - EDGE;
    if (right >= MIN_W) return { kind: 'right', left: r.right + GAP, width: Math.min(MAX_W, right) };
    const left = r.left - GAP - EDGE;
    if (left >= MIN_W) { const w = Math.min(MAX_W, left); return { kind: 'left', left: r.left - GAP - w, width: w }; }
    if (r.fixed || innerWidth < MIN_W + 360) return { kind: 'overlay' }; // a modal can't be moved; phones overlay
    const w = Math.min(MAX_W, Math.max(MIN_W, innerWidth - r.width - GAP - 2 * EDGE));
    return { kind: 'shift', left: innerWidth - EDGE - w, width: w };
  }
  function layoutDrawer() {
    const { box } = panel;
    if (!card || innerWidth <= 520) { box.style.left = ''; box.style.width = ''; setShift(0); return; }
    const key = `${innerWidth}|${card.fixed ? 'modal' : 'page'}|${panel.st.open}`;
    if (!mode || mode.key !== key || (mode.kind !== 'shift' && mode.cardKey !== card.key)) mode = { ...decide(card), key, cardKey: card.key };
    if (mode.kind === 'overlay') { box.style.left = ''; box.style.width = ''; setShift(0); return; }
    box.style.left = `${mode.left}px`;
    box.style.right = 'auto';
    box.style.width = `${mode.width}px`;
    setShift(mode.kind === 'shift' ? mode.width + GAP + EDGE : 0);
  }
  // content.js reports the composer card on every refresh.
  function dock(rect) {
    if (!rect) { card = null; return; }
    card = { left: rect.left, right: rect.right, width: rect.width, fixed: rect.fixed, key: `${Math.round(rect.left)}|${Math.round(rect.width)}|${rect.fixed}` };
    if (panel && !panel.box.hidden) layoutDrawer();
  }

  const getPanel = () => panel || create();

  // The panel's font, bundled with the extension (SIL OFL). Loaded from bytes so the site's
  // font-src CSP doesn't apply; registered on the page so the shadow root can use it.
  let fontsLoaded = false;
  function loadFonts() {
    if (fontsLoaded || !document.fonts || typeof FontFace === 'undefined' || !globalThis.chrome || !chrome.runtime || !chrome.runtime.getURL) return;
    fontsLoaded = true;
    for (const w of [400, 600, 700, 800]) {
      fetch(chrome.runtime.getURL(`fonts/BricolageGrotesque-${w}.woff2`)).then((r) => r.arrayBuffer())
        .then((buf) => new FontFace('Bricolage Grotesque', buf, { weight: String(w) }).load())
        .then((f) => document.fonts.add(f)).catch(() => { /* system font fallback */ });
    }
  }

  function show(visible) {
    const p = getPanel();
    if (p.visible === visible) return;
    p.visible = visible;
    apply();
  }

  // Bubble ring + score badge reflect the gate.
  function status(tone, score) {
    const p = getPanel();
    p.bubble.className = `bubble ${tone || 'neutral'}`;
    p.bscore.textContent = score || '';
  }

  const isOpen = () => Boolean(panel && panel.st.open);
  function open(v = true) { const p = getPanel(); p.st.open = v; save(p.st); apply(); }
  function flash() { const p = getPanel(); p.box.classList.remove('flash'); void p.box.offsetWidth; p.box.classList.add('flash'); }

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }

  // Replace the whole draft the way a person would: select all inside the editor, then paste.
  // X (Draft.js) and LinkedIn (Quill) handle paste themselves and keep their editor intact;
  // a plain contenteditable gets an insertText instead. Never rewrites the editor's DOM directly.
  function replaceDraft(editor, text) {
    editor.focus();
    const sel = getSelection();
    document.execCommand('selectAll');
    if (!sel.anchorNode || !editor.contains(sel.anchorNode)) {
      // selectAll escaped the editor: select the editor's own text instead.
      const r = document.createRange();
      r.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    let handled = false;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      handled = !editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch { /* no synthetic clipboard events */ }
    if (!handled) document.execCommand('insertText', false, text);
    return true;
  }

  // Apply one edit: replace `span` with `replacement` (or the whole draft when span is empty).
  // Only ever called from a click in the drawer.
  function applyToEditor(editor, span, replacement) {
    const current = (editor.innerText || '').replace(/\u200b/g, '').replace(/\n$/, '');
    let next = replacement;
    if (span) {
      if (!current.includes(span)) return false;
      next = current.replace(span, replacement);
    }
    return replaceDraft(editor, next);
  }

  globalThis.SupertweetUI = { getPanel, show, place, status, isOpen, open, flash, dock, h, copy, applyToEditor, replaceDraft };
})();
