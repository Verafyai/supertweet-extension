// Background service worker: the only part of the extension that makes network calls: to the
// Supertweet grader (hosted backend or localhost), and weekly to xai-org/x-algorithm on GitHub to
// keep X's ranking weights current. Draft text only ever goes to the grader, already masked.
importScripts('settings.js', 'objectives.js', 'x-linter.js');
const { merge, isLocalUrl, isAllowedBackend } = globalThis.SupertweetSettings;
const { validateObjectives } = globalThis.SupertweetObjectives;
const { parseParams, diffParams, syncAlerts } = globalThis.SupertweetXLinter;

const TIMEOUT_MS = 110_000;
const files = {};
async function bundled(name) {
  if (!files[name]) files[name] = await (await fetch(chrome.runtime.getURL(`config/${name}`))).json();
  return files[name];
}

async function backendInfo() {
  const { settings, apiToken, apiUser } = await chrome.storage.local.get({ settings: {}, apiToken: null, apiUser: null });
  const base = merge(settings).backendUrl.replace(/\/$/, '');
  return { base, local: isLocalUrl(base), token: apiToken, user: apiUser };
}

async function call(path, init = {}) {
  const { base, local, token } = await backendInfo();
  if (!isAllowedBackend(base)) return { ok: false, error: 'grader URL must be the Supertweet backend or localhost' };
  if (!local && !token) return { ok: false, error: 'Not linked yet: open supertweet-plum.vercel.app and connect X', unlinked: true };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { ...(init.headers || {}) };
    if (!local) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { ...init, headers, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && !local) {
      await chrome.storage.local.remove(['apiToken', 'apiUser']);
      return { ok: false, error: 'Link expired: open supertweet-plum.vercel.app to re-link', unlinked: true };
    }
    if (!res.ok) return { ok: false, error: body.error || `grader HTTP ${res.status}` };
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'grader timed out' : `grader unreachable at ${base}` };
  } finally {
    clearTimeout(t);
  }
}

// X's ranking weights: the bundled file, with any weekly-synced values on top.
async function rules() {
  const base = await bundled('x-algorithm-rules.json');
  let { algoSync } = await chrome.storage.local.get({ algoSync: null });
  // Banners stored by older versions listed every new param "to review": keep only real alerts.
  if (algoSync && algoSync.banner && !algoSync.banner.alerts) {
    const alerts = syncAlerts({ changed: algoSync.banner.changed || [] }).alerts;
    algoSync = { ...algoSync, banner: alerts.length ? { at: algoSync.banner.at, alerts } : null };
    chrome.storage.local.set({ algoSync });
  }
  if (!algoSync || !algoSync.params) return { ...base, sync: algoSync };
  const pick = (obj) => Object.fromEntries(Object.keys(obj).map((k) => [k, k in algoSync.params ? algoSync.params[k] : obj[k]]));
  return { ...base, action_weights: pick(base.action_weights), distribution_params: pick(base.distribution_params), sync: algoSync };
}

async function config() {
  const [objectives, r, info] = await Promise.all([bundled('objectives.json'), rules(), backendInfo()]);
  const { settings, objectivesOverride, privateTerms } = await chrome.storage.local.get({ settings: {}, objectivesOverride: null, privateTerms: [] });
  // An edited objectives file only applies if it validates.
  const useOverride = objectivesOverride && validateObjectives(objectivesOverride).length === 0;
  return {
    objectivesDoc: useOverride ? objectivesOverride : objectives, objectivesSource: useOverride ? 'edited' : 'bundled',
    rules: r, privateTerms: privateTerms || [], settings: merge(settings), unlinked: !info.local && !info.token,
  };
}

async function grade(payload) {
  const { local } = await backendInfo();
  const r = await call(local ? '/grade' : '/api/grade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  // The hosted API returns { raw, result, decision, ... }; the content script parses `raw` itself.
  return r.ok && !local ? { ok: true, data: r.data.raw } : r;
}

async function health() {
  const { local, user } = await backendInfo();
  if (local) return call('/health', { method: 'GET' });
  const r = await call('/api/me', { method: 'GET' });
  if (!r.ok) return r;
  return { ok: true, data: { hosted: true, user: r.data.user ? r.data.user.username : user, connected: r.data.connected, has_key: r.data.configured.anthropic } };
}

// ---------- Weekly algorithm sync ----------
// Changed values update automatically. The panel is only told about what affects posts (action
// weights and distribution params), only when a value changes, in plain words ("Replies now weigh
// 6 (was 5)."). Everything else (retrieval limits, sampling, Kafka, shadow traffic, new or removed
// params, README notes) goes to a developer log in storage, never to the panel.
async function syncAlgorithm() {
  const base = await bundled('x-algorithm-rules.json');
  const prev = (await chrome.storage.local.get({ algoSync: null })).algoSync || {};
  const stored = prev.params || { ...base.action_weights, ...base.distribution_params };
  const src = await (await fetch(base.raw_source)).text();
  const synced = parseParams(src);
  if (!Object.keys(synced).length) throw new Error('no params found in param.rs');
  const d = diffParams(stored, synced);
  const params = { ...stored };
  for (const c of d.changed) params[c.name] = c.to; // weights update automatically
  let readme = [];
  try {
    const md = await (await fetch('https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md')).text();
    const sec = md.split(/^##\s+Latest Updates\s*$/im)[1] || '';
    readme = (sec.split(/^##\s/m)[0].match(/^\s*[-*]\s+.+$/gm) || []).map((x) => x.replace(/^\s*[-*]\s+/, '').trim()).slice(0, 20);
  } catch { /* README is optional */ }
  const seen = new Set(prev.readmeSeen || []);
  const newEntries = readme.filter((x) => !seen.has(x));
  const { alerts, devlog } = syncAlerts(d);
  const { algoDevLog = [] } = await chrome.storage.local.get({ algoDevLog: [] });
  const at = new Date().toISOString();
  await chrome.storage.local.set({
    algoSync: { params, checkedAt: Date.now(), banner: alerts.length ? { at: Date.now(), alerts } : null, readmeSeen: [...seen, ...newEntries].slice(-200) },
    algoDevLog: algoDevLog.concat([...devlog, ...newEntries.map((x) => `readme: ${x}`)].map((line) => ({ at, line }))).slice(-500),
  });
  return d;
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('algo-sync', { periodInMinutes: 7 * 24 * 60, delayInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'algo-sync') syncAlgorithm().catch(() => {}); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'config') return reply(await config());
    if (msg.type === 'grade') return reply(await grade(msg.payload));
    if (msg.type === 'tune' || msg.type === 'analyze' || msg.type === 'critique') {
      const { local } = await backendInfo();
      const r = await call(local ? `/${msg.type}` : `/api/${msg.type}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg.payload) });
      return reply(r);
    }
    if (msg.type === 'health') return reply(await health());
    if (msg.type === 'sync-now') return reply(await syncAlgorithm().then((d) => ({ ok: true, data: d }), (e) => ({ ok: false, error: e.message })));
    if (msg.type === 'dismiss-banner') { const { algoSync } = await chrome.storage.local.get({ algoSync: null }); if (algoSync) await chrome.storage.local.set({ algoSync: { ...algoSync, banner: null } }); return reply({ ok: true }); }
    if (msg.type === 'save') {
      const { local } = await backendInfo();
      if (local) return reply({ ok: true, skipped: 'local grader has no dashboard' });
      return reply(await call('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: msg.rows }) }));
    }
    reply({ ok: false, error: 'unknown message' });
  })().catch((e) => reply({ ok: false, error: e.message }));
  return true; // async reply
});
