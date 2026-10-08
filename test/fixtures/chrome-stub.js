// Stand-in for the extension APIs so content scripts run on plain test pages.
// chrome.storage.local persists in localStorage; chrome.runtime.sendMessage plays the background worker.
(() => {
  const KEY = 'st-store';
  const listeners = [];
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  window.chrome = window.chrome || {};
  chrome.storage = {
    local: {
      get(defs, cb) {
        const s = read();
        const keys = typeof defs === 'string' ? [defs] : Object.keys(defs || {});
        const out = typeof defs === 'object' && defs ? { ...defs } : {};
        for (const k of keys) if (k in s) out[k] = s[k];
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set(obj, cb) {
        const s = read(); const ch = {};
        for (const k in obj) { ch[k] = { oldValue: s[k], newValue: obj[k] }; s[k] = obj[k]; }
        localStorage.setItem(KEY, JSON.stringify(s));
        listeners.forEach((l) => l(ch, 'local'));
        if (cb) cb();
        return Promise.resolve();
      },
      remove(k) { const s = read(); delete s[k]; localStorage.setItem(KEY, JSON.stringify(s)); listeners.forEach((l) => l({ [k]: { newValue: undefined } }, 'local')); return Promise.resolve(); },
    },
    onChanged: { addListener: (l) => listeners.push(l) },
  };
  async function handle(msg) {
    const s = read();
    if (msg.type === 'config') {
      const [objectives, rules] = await Promise.all([fetch('/config/objectives.json').then((r) => r.json()), fetch('/config/x-algorithm-rules.json').then((r) => r.json())]);
      const ok = s.objectivesOverride && globalThis.SupertweetObjectives && globalThis.SupertweetObjectives.validateObjectives(s.objectivesOverride).length === 0;
      return { objectivesDoc: ok ? s.objectivesOverride : objectives, objectivesSource: ok ? 'edited' : 'bundled', rules: { ...rules, sync: s.algoSync || null }, privateTerms: s.privateTerms || [], settings: s.settings || {}, unlinked: Boolean(s.unlinked) };
    }
    const post = async (path, body) => {
      try {
        const res = await fetch(path, { method: 'POST', body: JSON.stringify(body) });
        const j = await res.json();
        return res.ok ? { ok: true, data: j } : { ok: false, error: j.error || `grader HTTP ${res.status}` };
      } catch { return { ok: false, error: 'backend unreachable' }; }
    };
    if (msg.type === 'grade') { window.__gradeCalls = (window.__gradeCalls || 0) + 1; return post('/grade', msg.payload); }
    if (msg.type === 'tune' || msg.type === 'analyze' || msg.type === 'critique') return post(`/${msg.type}`, msg.payload);
    if (msg.type === 'save') { (window.__saved = window.__saved || []).push(...msg.rows); return { ok: true }; }
    if (msg.type === 'dismiss-banner') return { ok: true };
    return { ok: false, error: 'unknown message' };
  }
  chrome.runtime = { lastError: null, getURL: (p) => `/${p}`, sendMessage(msg, cb) { const p = handle(msg); if (cb) p.then(cb); return p; } };
})();
