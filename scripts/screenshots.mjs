// Regenerates the README screenshots (docs/images/) from the test fixtures, with the real grading
// pipeline on the mock model (no API key needed). Run: node scripts/screenshots.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEnv, GRADE_DRAFT, KILL_FIXTURES } from '../test/env.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images');
mkdirSync(OUT, { recursive: true });
const { ev, go, close, until, sleep, send } = await startEnv({ port: 8805, cdpPort: 9355 });
const SR = `document.querySelector('[data-supertweet=panel]').shadowRoot`;
const ED = `document.querySelector('[data-testid=tweetTextarea_0]')`;

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 2, mobile: false });

// A page-level clip, in CSS pixels.
async function shot(name, rect, pad = 0) {
  await ev('document.fonts.ready.then(() => 1)');
  await sleep(400);
  const r = await rect();
  const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2, scale: 1 } });
  writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
  console.log('wrote', name);
}
const panelRect = () => ev(`(() => { const p = ${SR}.querySelector('.st-panel').getBoundingClientRect(); return { x: p.x, y: p.y + scrollY, width: p.width, height: p.height }; })()`);
const setDraft = async (t) => {
  await ev(`(() => { const e = ${ED}; e.focus(); e.textContent = ${JSON.stringify(t)}; e.dispatchEvent(new InputEvent('input', { bubbles: true })); })()`);
  await until(`!!${SR}.querySelector('[data-act=grade]')`, 4000);
  for (let i = 0; i < 4; i++) { await ev(`(() => { const b = ${SR}.querySelector('[data-act=grade]'); if (b) b.click(); })()`); if (await until(`!${SR}.querySelector('[data-act=grade]')`, 600)) break; }
};

await go('/home');
await ev('localStorage.clear()');
await ev(`localStorage.setItem('st-store', JSON.stringify({ settings: { myHandles: ['demo_team'] } }))`);
await ev(`localStorage.setItem('supertweet:panel', JSON.stringify({ open: true }))`);
await go('/home', 1200);

// 1. The score panel, locked, with Get to 8
await setDraft(GRADE_DRAFT);
await until(`!!${SR}.querySelector('.st-card')`, 8000);
await shot('panel.png', panelRect);

// 2. Why this score (the critique)
await ev(`${SR}.querySelector('[data-act=critique]').click()`);
await until(`!!${SR}.querySelector('.st-crit .cr')`, 8000);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 2400, deviceScaleFactor: 2, mobile: false });
await sleep(500);
await shot('critique.png', panelRect);
await ev(`${SR}.querySelector('[data-act=critique]').click()`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 2, mobile: false });

// 3. Tune for X
await ev(`${SR}.querySelector('[data-act=tune]').click()`);
await until(`!!${SR}.querySelector('[data-tune]')`, 8000);
await shot('tune.png', () => ev(`(() => { const a = ${SR}.querySelector('.st-algo').getBoundingClientRect(); const t = ${SR}.querySelector('.st-tune').getBoundingClientRect(); return { x: a.x - 20, y: a.y + scrollY - 10, width: a.width + 40, height: t.bottom - a.y + 20 }; })()`));

// 4. A kill: red block, quoted span, "Post anyway, with a reason"
await setDraft(KILL_FIXTURES['personal or veiled attack']);
await until(`${SR}.querySelector('.st-post').textContent.trim() === 'Kill: personal or veiled attack'`, 8000);
await shot('kill.png', panelRect);

// 5. A past post's Details, with reach versus trust
await until(`(() => { const h = document.querySelector('#t102 [data-supertweet=past-badge]'); return h && h.shadowRoot.textContent.includes('/10'); })()`, 8000);
await ev(`document.querySelector('#t102 [data-supertweet=past-badge]').shadowRoot.querySelector('[data-act=details]').click()`);
await until(`!!document.querySelector('#t102 [data-supertweet=past-badge]').shadowRoot.querySelector('.cr')`, 8000);
await ev(`document.querySelector('[data-supertweet=panel]').style.display = 'none'; document.body.style.background = '#fff'; document.querySelectorAll('article').forEach((a) => { a.style.background = '#fff'; a.style.width = '600px'; }); document.querySelectorAll('[role=group]').forEach((g) => { g.style.display = 'none'; })`);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await shot('past-post.png', () => ev(`(() => { const r = document.getElementById('t102').getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; })()`), 8);

process.exit(close() ? 1 : 0);
