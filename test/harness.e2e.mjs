// End-to-end: headless Chrome against test/harness.html (a route-aware mock of X): the bubble +
// drawer (the score panel, src/panel.js), the drawer-only send path on X, editor-safe edits and
// Undo, past-post badges, and the history scan + confirmed delete. The panel's 12 acceptance
// checks are in test/acceptance.e2e.mjs.
// Run: node test/harness.e2e.mjs
import { startEnv } from './env.mjs';

const { send, ev, go, until, check, close, sleep, requests } = await startEnv();
const SR = `document.querySelector('[data-supertweet=panel]').shadowRoot`;
const NATIVE = `document.querySelector('[data-testid=tweetButtonInline]')`;
const postBtn = () => ev(`(() => { const b = ${SR}.querySelector('.st-post'); return { label: b.textContent.trim(), disabled: b.disabled }; })()`);
const waitPost = (re, ms = 6000) => until(`(() => { const b = ${SR}.querySelector('.st-post'); return b && ${re}.test(b.textContent.trim()) ? b.textContent : null; })()`, ms);
const panelText = () => ev(`${SR}.querySelector('.st-panel').innerText`);
const log = () => ev(`document.getElementById('log').textContent`);
// Grading runs when you ask: press Grade (the pill slot) once the panel shows it.
const pressGrade = async () => { await until(`!!${SR}.querySelector('[data-act=grade]')`, 4000); await ev(`(() => { const b = ${SR}.querySelector('[data-act=grade]'); if (b) b.click(); })()`); };
async function type(text) {
  await ev(`(() => { const t = document.querySelector('[data-testid=tweetTextarea_0]'); t.textContent = ''; t.focus(); })()`);
  await send('Input.insertText', { text });
  await sleep(80);
  await pressGrade();
}

await go('/home');
await ev('localStorage.clear()');
await ev(`localStorage.setItem('st-store', JSON.stringify({ settings: { myHandles: ['demo_team'] } }))`); // "Your other X handles" in the popup
await go('/home');

// ---- Compose on X ----
check('bubble shows for the composer; the native Post button is hidden', Boolean(await until(`!!document.querySelector('[data-supertweet=panel]') && !${SR}.querySelector('.bubble').hidden`, 3000)) && await ev(`getComputedStyle(${NATIVE}).display === 'none'`));
await ev(`${SR}.querySelector('.bubble').click()`);
check('drawer opens from the bubble', await ev(`!${SR}.querySelector('.p').hidden`));

await ev(`document.querySelector('[data-testid=tweetTextarea_0]').focus()`);
for (const ch of 'Shipped') await send('Input.insertText', { text: ch });
await sleep(150);
check('the drawer updates while typing: a Grade button, Post says "Grade to post"', Boolean(await until(`!!${SR}.querySelector('[data-act=grade]')`, 1500)) && (await postBtn()).label === 'Grade to post', await panelText());

await type('Some people are clowns for still writing tests by hand.');
check('a trust kill holds Post, names the category, and offers "Post anyway, with a reason"', Boolean(await waitPost(/^Kill: personal or veiled attack$/)) && await ev(`!!${SR}.querySelector('a[href="#override"]')`) && /“Some people are clowns/.test(await panelText()), JSON.stringify(await postBtn()) + (await panelText()).slice(-300));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 4, windowsVirtualKeyCode: 13 });
await sleep(100);
check('Cmd+Enter is blocked', !(await log()).includes('POSTED'));

const SWEET = 'Shipped a Brave extension that grades my X drafts on-device. The trick: regexes plus a small lexicon instead of an LLM, so it re-scores in under 1ms.';
await type(SWEET);
await waitPost(/^Post to X$/, 6000);
const t = await panelText();
check('scored against the agent-builder objective: 9.0, Ready; no audiences', await ev(`${SR}.querySelector('.st-obj select').selectedOptions[0].textContent`) === 'Hands-on agent builder' && /9\.0/.test(t) && /Ready/.test(t) && !/Resonates|Target interest|Audiences/.test(t), t);
check('algorithm is one info line on X', await ev(`${SR}.querySelectorAll('.st-algo').length`) === 1);
await ev(`${SR}.querySelector('[data-act=details]').click()`);
check('Details opens the X review: what to fix, and one line for the checks that pass', Boolean(await until(`!!${SR}.querySelector('.st-pass')`, 5000)) && /\d+ checks? pass\./.test(await ev(`${SR}.querySelector('.st-checks').textContent`)));
await ev(`${SR}.querySelector('.st-post').click()`);
await until(`document.getElementById('log').textContent.includes('POSTED')`, 4000);
check('drawer Post clicks X\'s hidden button; the post goes out', (await log()).includes('POSTED') && Boolean(await until(`/Posted/.test(${SR}.querySelector('.st-foot').textContent)`, 4000)));

// ---- Below 8: Post anyway with a reason ----
await type('Our agent evals got better after the quickstart rewrite LOW');
await waitPost(/needs 8\+/, 6000);
await ev(`${SR}.querySelector('a[href="#override"]').click()`);
await ev(`(() => { const i = ${SR}.querySelector('input[data-override]'); i.value = 'Posting the raw note on purpose'; i.dispatchEvent(new Event('input')); })()`);
await ev(`${SR}.querySelector('[data-act=unlock]').click()`);
check('"Post anyway, with a reason" unlocks Post', Boolean(await waitPost(/^Post to X$/, 3000)) && !(await postBtn()).disabled && /Sending with your reason/.test(await panelText()), JSON.stringify(await postBtn()) + (await panelText()).slice(-200));

// ---- Applying a step goes through X's own paste handling; you can keep typing; Undo ----
const ED = `document.querySelector('[data-testid=tweetTextarea_0]')`;
const SHORT = 'X makes no sense to me\n\nso I built a real-time linter that cross checks it all\n\nbiggest surprise so far: I am bad at this';
await ev(`(() => { const e = ${ED}; e.focus(); e.textContent = ${JSON.stringify(SHORT)}; e.dispatchEvent(new InputEvent('input', { bubbles: true })); })()`);
await pressGrade();
await until(`(() => { const s = [...${SR}.querySelectorAll('.st-step')].find((x) => x.querySelector('input')); return !!s; })()`, 8000);
const ask = `[...${SR}.querySelectorAll('.st-step')].find((x) => x.querySelector('input'))`;
await ev(`(() => { const i = ${ask}.querySelector('input'); i.value = '6'; i.dispatchEvent(new Event('input')); })()`);
const pastes = await ev('window.__pastes');
await ev(`${ask}.querySelector('[data-act=apply]').click()`);
await sleep(500);
check('Apply edits through the editor\'s own paste handling; line breaks intact', await ev('window.__pastes') === pastes + 1 && (await ev(`${ED}.innerText`)) === SHORT.replace('I am bad at this', "I'm bad at this, even after 6 hours of building it."), JSON.stringify(await ev(`${ED}.innerText`)));
await ev(`${ED}.focus(); (() => { const r = document.createRange(); r.selectNodeContents(${ED}); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
await send('Input.insertText', { text: ' typed after' });
check('you can keep typing after Apply', / typed after$/.test(await ev(`${ED}.innerText`)), await ev(`${ED}.innerText`));
await until(`!!${SR}.querySelector('[data-act=undo]')`, 3000);
await ev(`${SR}.querySelector('[data-act=undo]').click()`);
await sleep(300);
check('Undo restores the draft from before Apply', (await ev(`${ED}.innerText`)) === SHORT, JSON.stringify(await ev(`${ED}.innerText`)));
check('no "repeats a point" kill', !/repeats a point/i.test(await panelText()));

// ---- Past posts: badges on my tweets ----
const badge = (tid) => ev(`(() => { const h = document.querySelector('#${tid} [data-supertweet=past-badge]'); return h ? h.shadowRoot.textContent : null; })()`);
await until(`(() => { const h = document.querySelector('#t101 [data-supertweet=past-badge]'); return h && h.shadowRoot.textContent.includes("/10"); })()`, 8000);
check('my past tweets get a Developer Trust badge: score, bucket, why', /9\.0\/10/.test(await badge('t101')) && /Sweet/.test(await badge('t101')) && /specific learning/.test(await badge('t101')), await badge('t101'));
check("someone else's tweet isn't graded", (await badge('t103')) === null);

// ---- Past posts: Details (the critique) under the unchanged collapsed line ----
const line = (tid) => ev(`document.querySelector('#${tid} [data-supertweet=past-badge]').shadowRoot.querySelector('.t').textContent`);
const sr = (tid) => `document.querySelector('#${tid} [data-supertweet=past-badge]').shadowRoot`;
await until(`(() => { const h = document.querySelector('#t102 [data-supertweet=past-badge]'); return h && h.shadowRoot.textContent.includes('/10'); })()`, 8000);
const before101 = await line('t101');
check('collapsed line: score, bucket, one line on why (unchanged)', /^9\.0\/10Sweet/.test(before101) && /specific learning/.test(before101), before101);
await ev(`${sr('t101')}.querySelector('[data-act=details]').click()`);
await until(`!!${sr('t101')}.querySelector('.cr')`, 8000);
const d101 = await ev(`${sr('t101')}.querySelector('.cr').innerText`);
const quotes101 = await ev(`[...${sr('t101')}.querySelectorAll('.cr q')].map((q) => q.textContent)`);
const text101 = await ev(`document.querySelector('#t101 [data-testid=tweetText]').textContent`);
check('Details: what works, what costs points, pushback, how to get to 8, and the four sub-ratings', /What works/.test(d101) && /Pushback/.test(d101) && /How to get to 8/.test(d101) && /Shows building \d+ · Specific \d+ · Useful to a developer \d+ · Voice \d+/.test(d101), d101);
check('Details quotes at least one exact span from the post (and nothing that isn\'t in it)', quotes101.length >= 1 && quotes101.every((q) => text101.includes(q)), JSON.stringify(quotes101));
check('the collapsed line is unchanged with Details open', (await line('t101')) === before101);
check('reach next to the trust score: views, likes, replies, reposts read from the page', /Trust 9\.0 · 1\.2K views · 14 likes · 3 replies · 1 repost/.test(d101), d101);
await ev(`${sr('t102')}.querySelector('[data-act=details]').click()`);
await until(`!!${sr('t102')}.querySelector('.cr')`, 8000);
const d102 = await ev(`${sr('t102')}.querySelector('.cr').innerText`);
check('a low-trust post that outreached a Sweet one says so in one line', /Reach beat trust here: this 0\.0 post got 8\.4K views, more than your 9\.0 post/.test(d102), d102);
check('reach is saved with the trust score for the dashboard', requests.some((r) => r.route === '/grade' && r.source === 'past' && r.engagement && r.engagement.views === 1200 && r.engagement.likes === 14));
check('team-handle tweets are graded too', Boolean(await until(`(() => { const h = document.querySelector('#t105 [data-supertweet=past-badge]'); return h && h.shadowRoot.textContent.includes("/10"); })()`, 8000)));

// ---- History scan ----
await go('/demo_dev/with_replies');
const sheetBtn = (label) => `[...document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)}))`;
await ev(`document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelector('.launch').click()`);
await sleep(300);
await ev(`${sheetBtn('Scan my history')}.click()`);
const done = await until(`document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelector('.status').textContent.startsWith('Scan done')`, 30000);
const sheetText = await ev(`document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelector('.sheet').innerText`);
check('scan finishes and caches only my tweets', done && /4 tweets/.test(sheetText), sheetText);
check('kills recommended for delete; trust grades from the cache: score, bucket, why, link, worst first', /Recommended deletes \(2\)/.test(sheetText) && sheetText.includes('clowns for still') && !sheetText.includes('says someone else') && /4 graded/.test(sheetText) && /0\.0\/10\s*Kill/i.test(sheetText) && /x\.com\/|\/status\//.test(sheetText), sheetText);
await ev(`[...document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelectorAll('button')].find((b) => /^All/.test(b.textContent)).click()`);
const allRows = await ev(`[...document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelectorAll('.row .sc')].map((x) => x.textContent)`);
check('All: every post listed worst first', allRows.length === 4 && allRows.map((x) => parseFloat(x)).every((v, i, a) => !i || a[i - 1] <= v), JSON.stringify(allRows));
check('deleting is never in bulk: one Delete button per post, no "delete all"', await ev(`(() => { const r = document.querySelector('[data-supertweet=sheet]').shadowRoot; return r.querySelectorAll('.row').length === r.querySelectorAll('.row button.del').length && ![...r.querySelectorAll('button')].some((b) => /delete (all|selected|\d+)/i.test(b.textContent)); })()`));
const cached = await ev(`Object.keys(JSON.parse(localStorage.getItem('st-store')).scan).sort().join(',')`);
check('cache in storage', cached === '101,102,104,105', cached);

// ---- Delete: one tweet, confirm bar, X's own menu ----
const delBtn = `[...document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelectorAll('.row')].find((r) => r.innerText.includes('clowns for still')).querySelector('button.del')`;
await ev(`${delBtn}.click()`);
await sleep(1500);
check('delete opens tweet page with confirm bar', await ev(`location.pathname === '/demo_dev/status/102' && !!document.querySelector('div:not([data-supertweet]) ') && [...document.documentElement.children].some((c) => c.shadowRoot && c.shadowRoot.textContent.includes('delete this post'))`), await ev('location.href'));
check('nothing deleted before confirm', !(await ev(`document.getElementById('log').textContent`)).includes('DELETED'), 'no DELETED yet');
await ev(`[...document.documentElement.children].find((c) => c.shadowRoot && c.shadowRoot.textContent.includes('delete this post')).shadowRoot.querySelector('.go').click()`);
const deleted = await until(`document.getElementById('log') && document.getElementById('log').textContent.includes('DELETED')`, 5000);
await sleep(2000);
const after = await ev(`JSON.parse(localStorage.getItem('st-store')).scan['102'].deleted === true && location.pathname`);
check('confirm deletes via X menu and marks cache', deleted && after === '/demo_dev/with_replies', `deleted=${deleted} after=${after}`);
const dlog = await ev(`JSON.parse(localStorage.getItem('st-store')).deletionLog`);
check('every deletion is logged (which post, when, its score and bucket)', dlog.length === 1 && dlog[0].id === '102' && dlog[0].bucket === 'kill' && Boolean(dlog[0].at), JSON.stringify(dlog));
const sheetAfter = await until(`(() => { const s = document.querySelector('[data-supertweet=sheet]').shadowRoot.querySelector('.sheet'); return !s.hidden && s.innerText; })()`, 5000);
check('sheet reopens without the deleted tweet', sheetAfter && !sheetAfter.includes('clowns for still') && /3 tweets/.test(sheetAfter), sheetAfter);

process.exit(close() ? 1 : 0);
