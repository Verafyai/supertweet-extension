// Supertweet content script. Platform-agnostic: the adapter (src/adapters/*) knows the site's DOM.
// One bubble + drawer per page, for the composer you're working in. The native Post/Reply/Comment
// button is hidden; the drawer's Post button is the only way to send, and it stays disabled until
// the exact current draft passes (objective score of 8.0 or more, no open privacy questions, no safety kills,
// no placeholders), or you give a typed reason where that's allowed. It then clicks the hidden
// native button and confirms the post went out; if it didn't, or the native button can't be found,
// the native button comes back so you're never stuck. Content scripts make no network calls.
(() => {
  'use strict';
  const A = globalThis.SupertweetPlatform;
  if (!A) return;
  const UI = globalThis.SupertweetUI;
  const { hashText } = globalThis.SupertweetChecks;

  const HISTORY_MAX = 300;
  let history = [];
  let scanned = [];
  let pending = false;
  let lastActive = null;
  let allowSend = false;
  const restored = new WeakSet(); // native buttons given back after a failed send
  const storage = chrome.storage.local;
  let xProfile = {};

  const Aud = globalThis.SupertweetAudience.createAudience({ adapter: A, onChange: () => schedule(), context: linterContext });

  // Your other X handles (settings): their posts count as yours for badges and history.
  const applyHandles = () => { if (A.setHandles) A.setHandles(Aud.settings().myHandles); };
  Aud.ready.then(() => { applyHandles(); schedule(); });
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.settings) setTimeout(() => { applyHandles(); schedule(); }, 50); });

  const liveScan = (scan) => Object.values(scan || {}).filter((t) => !t.deleted).map((t) => t.text);
  storage.get({ history: [], scan: {}, xProfile: {} }, (r) => queueMicrotask(() => { history = r.history || []; scanned = liveScan(r.scan); xProfile = r.xProfile || {}; schedule(); }));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.scan) { scanned = liveScan(c.scan.newValue); schedule(); }
    if (c.xProfile) xProfile = c.xProfile.newValue || {};
  });

  const draftOf = (el) => A.readDraft(el).text;
  const visible = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // Inputs for the X algorithm info line, read from the page (no manual inputs).
  function linterContext(el) {
    const media = A.composerMedia ? A.composerMedia(el) : { media: 'none' };
    const since = xProfile.lastPostAt ? Math.round((Date.now() - Date.parse(xProfile.lastPostAt)) / 60000) : undefined;
    return { ...media, minutesSinceLastPost: since, followers: xProfile.followers, recent: history.concat(scanned).slice(-20), isReply: A.isReplyComposer ? A.isReplyComposer(el) : false };
  }

  // ---------- Which composer the drawer follows ----------

  function activeComposer() {
    const editors = A.findComposer().filter(visible);
    if (!editors.length) return null;
    const focused = editors.find((e) => e.contains(document.activeElement) || e === document.activeElement);
    if (focused) return (lastActive = focused);
    if (lastActive && editors.includes(lastActive)) return lastActive;
    // X keeps a home composer behind the compose modal: prefer the one in the topmost dialog.
    const inDialog = editors.filter((e) => e.closest('[role="dialog"]'));
    return inDialog[inDialog.length - 1] || editors.find((e) => draftOf(e)) || editors[0];
  }

  // ---------- Gate for a send button (all boxes it posts, e.g. a thread) ----------

  function gateFor(btn) {
    const boxes = A.composersFor(btn);
    const texts = boxes.map(draftOf);
    if (!texts.some(Boolean)) return { held: true, reason: 'Write something', texts, boxes };
    for (const el of boxes) {
      if (!draftOf(el)) continue;
      Aud.track(el); // an edit since the last grade re-locks right here
      const d = Aud.decision(el);
      if (d.locked) return { held: true, reason: d.label, texts, boxes, decision: d };
    }
    return { held: false, reason: '', texts, boxes };
  }

  function recordPosted(texts, snaps) {
    for (const snap of snaps || []) Aud.markPosted(snap);
    const add = texts.filter(Boolean);
    if (!add.length) return;
    history = history.concat(add).slice(-HISTORY_MAX);
    storage.set({ history });
  }

  // ---------- Hide the native send buttons (re-applied whenever the site re-renders them) ----------

  const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  function hideNative() {
    for (const btn of A.sendButtons()) {
      if (restored.has(btn)) {
        if (btn.hasAttribute('data-supertweet-hidden')) { btn.removeAttribute('data-supertweet-hidden'); btn.removeAttribute('aria-hidden'); }
        continue;
      }
      setAttr(btn, 'data-supertweet-hidden', '1');
      setAttr(btn, 'aria-hidden', 'true');
    }
  }

  // ---------- Drawer ----------

  // The composer card: the widest ancestor of the editor that's still composer-sized (X's modal or
  // inline box, LinkedIn's share box). The drawer docks beside it so the draft stays visible.
  function cardOf(el) {
    let card = el;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const w = n.getBoundingClientRect().width;
      if (w > 720 || w >= innerWidth - 40) break;
      card = n;
    }
    const r = card.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, fixed: Boolean(el.closest('[role="dialog"], [aria-modal="true"]')) };
  }

  let note = null; // "Posted." / "Post didn't go through…", shown under the Post button for a few seconds
  let sending = false;

  function refresh() {
    hideNative();
    const el = activeComposer();
    UI.show(Boolean(el));
    if (!el) return;
    const p = UI.getPanel();
    UI.dock(cardOf(el));
    Aud.track(el);
    const btn = A.buttonFor(el);
    const native = btn && A.sendLabel ? A.sendLabel(btn) : 'Post';
    const site = A.id === 'x' ? 'X' : 'LinkedIn';
    let postLabel = null;
    if (sending) postLabel = 'Posting…';
    else if (!btn) postLabel = `Can't find ${site}'s ${native} button; post normally`;
    else {
      const g = gateFor(btn); // a thread: every box it posts must pass
      if (g.held && !Aud.decision(el).locked) postLabel = g.reason;
    }
    const sendLabel = /^post$/i.test(native) ? `Post to ${site}` : native;
    const { d, state } = Aud.render(el, p.mount, p, { postLabel, sendLabel, note, onPost: onPanelPost });
    const score = typeof state.score === 'number' ? state.score.toFixed(1) : '';
    const held = state.hold || state.flags.length || !(state.score >= state.gate) || state.objectiveId === null;
    UI.status(!btn ? 'neutral' : !held || d.kind === 'overridden' ? 'green' : state.flags.some((f) => f.block) ? 'red' : d.kind === 'pending' ? 'neutral' : 'amber', score);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; refresh(); });
  }

  // The drawer's Post button: re-check, click the hidden native button, confirm it went out.
  async function onPanelPost() {
    const el = activeComposer();
    const btn = el && A.buttonFor(el);
    if (!btn || sending) return;
    const g = gateFor(btn);
    if (g.held) { UI.flash(); schedule(); return; }
    const snaps = g.boxes.map((b) => Aud.snapshot(b)).filter(Boolean);
    sending = true;
    schedule();
    allowSend = true;
    try { btn.click(); } finally { allowSend = false; }
    const ok = await confirmSent(g.boxes, btn);
    sending = false;
    if (ok) {
      recordPosted(g.texts, snaps);
      note = 'Posted.';
    } else {
      restored.add(btn); // never leave you stuck: the site's own button comes back
      note = "Post didn't go through. The site's own button is back if you need it.";
    }
    setTimeout(() => { note = null; schedule(); }, 4000);
    schedule();
  }

  function confirmSent(boxes, btn) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (boxes.every((b) => !b.isConnected || !draftOf(b)) || !btn.isConnected) return resolve(true);
        if (Date.now() - start > 8000) return resolve(false);
        setTimeout(tick, 250);
      };
      setTimeout(tick, 300);
    });
  }

  // ---------- Block every other send path ----------

  function stop(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }

  function onPointer(e) {
    if (allowSend) return;
    const btn = A.isSendButton(e.target);
    if (!btn || restored.has(btn)) return;
    stop(e); // the drawer's Post button is the way to send
  }
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart', 'touchend', 'auxclick']) window.addEventListener(t, onPointer, true);

  window.addEventListener('keydown', (e) => {
    if (allowSend || !e.target || !e.target.closest) return;
    const onButton = A.isSendButton(e.target);
    if (onButton && !restored.has(onButton) && (e.key === 'Enter' || e.key === ' ')) return stop(e);
    const editor = A.isComposer(e.target);
    if (!editor) return;
    const btn = A.buttonFor(editor);
    if (!btn || restored.has(btn)) return; // no native button found: leave native behavior alone
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { stop(e); UI.open(true); Aud.gradeNow(editor); schedule(); return; } // grades; never sends
    if (e.key === 'Enter' && !e.shiftKey && A.enterSends && A.enterSends(editor)) return stop(e); // LinkedIn comments
  }, true);

  window.addEventListener('submit', (e) => {
    if (allowSend) return;
    const form = e.target;
    const editor = form && A.findComposer().find((x) => form.contains(x));
    const btn = editor && A.buttonFor(editor);
    if (btn && !restored.has(btn)) stop(e);
  }, true);

  // ---------- Live updates ----------

  for (const t of ['input', 'keyup', 'paste', 'cut', 'compositionend']) document.addEventListener(t, schedule, true);
  addEventListener('resize', schedule);
  document.addEventListener('focusin', (e) => { const ed = A.isComposer(e.target); if (ed) lastActive = ed; schedule(); }, true);

  const style = document.createElement('style');
  style.textContent = '[data-supertweet-hidden="1"] { display: none !important; }';
  (document.head || document.documentElement).appendChild(style);

  // Editors mount late and buttons re-render: re-apply on any DOM change.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-supertweet-hidden'] });

  // X profile facts for the algorithm info line: follower count and when you last posted.
  if (A.profileFacts) {
    setInterval(() => {
      const f = A.profileFacts();
      if (f && (f.followers !== xProfile.followers || f.lastPostAt !== xProfile.lastPostAt)) storage.set({ xProfile: { ...xProfile, ...f, updated: Date.now() } });
    }, 4000);
  }

  // Shared with history.js and past-posts.js (same isolated world).
  globalThis.SupertweetPage = { ...A, adapter: A, audience: Aud, hashText };
  schedule();
})();
