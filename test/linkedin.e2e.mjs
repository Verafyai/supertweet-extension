// End-to-end on LinkedIn fixtures with a mock grader: the bubble + drawer, objective scoring, the send
// gate on every path (drawer Post only), privacy checks, overrides, comments, articles, past posts.
// Run: node test/linkedin.e2e.mjs
import { startEnv } from './env.mjs';

const { send, ev, go, until, check, close, sleep, requests } = await startEnv({ port: 8766, cdpPort: 9334 });
const SR = `document.querySelector('[data-supertweet=panel]').shadowRoot`;
const NATIVE = `document.querySelector('.share-actions__primary-action')`;
const status = () => ev(`(${SR}.querySelector('.st-score') || {}).textContent || ''`);
const postBtn = () => ev(`(() => { const b = ${SR}.querySelector('.st-post'); return { label: b.textContent.trim(), disabled: b.disabled, over: b.classList.contains('over') }; })()`);
const sent = () => ev(`document.getElementById('log').textContent`);
const lastReq = (mode = 'score') => [...requests].reverse().find((r) => r.mode === mode);
const panelText = () => ev(`${SR}.querySelector('.st-panel').innerText`);

async function setStore(obj) { await ev(`localStorage.setItem('st-store', ${JSON.stringify(JSON.stringify(obj))})`); }
// Grading runs when you ask: press Grade (the pill slot) once the panel shows it.
const pressGrade = async () => { await until(`!!${SR}.querySelector('[data-act=grade]')`, 4000); await ev(`(() => { const b = ${SR}.querySelector('[data-act=grade]'); if (b) b.click(); })()`); };
async function type(text, sel = '[role=textbox][contenteditable]', { grade = true } = {}) {
  await ev(`(() => { const t = document.querySelector('${sel}'); t.textContent = ''; t.focus(); })()`);
  await send('Input.insertText', { text });
  await sleep(80);
  if (grade) await pressGrade();
}
const waitStatus = (re, ms = 6000) => until(`(() => { const s = (${SR}.querySelector('.st-score') || {}).textContent || ''; return ${re}.test(s) ? s : null; })()`, ms);
const waitPost = (re, ms = 6000) => until(`(() => { const b = ${SR}.querySelector('.st-post'); return b && ${re}.test(b.textContent.trim()) ? b.textContent : null; })()`, ms);
const clickIn = (sel) => ev(`${SR}.querySelector(${JSON.stringify(sel)}).click()`);
const typeReason = async (sel, text) => ev(`(() => { const i = ${SR}.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); })()`);

// ---------- Bubble, drawer, native button ----------
await go('/feed/');
await setStore({ settings: { linkedinMe: 'demo_dev' } });
await go('/feed/', 300);

check('editor mounts late and the bubble follows it (MutationObserver)', Boolean(await until(`!!document.querySelector('[data-supertweet=panel]') && !${SR}.querySelector('.bubble').hidden`, 4000)));
check('one panel per page', await ev(`document.querySelectorAll('[data-supertweet=panel]').length`) === 1);
await clickIn('.bubble');
check('the bubble opens the drawer; the bubble hides while it is open', await ev(`!${SR}.querySelector('.p').hidden && ${SR}.querySelector('.bubble').hidden`));
check('native Post is hidden (display:none + aria-hidden), not removed', await ev(`${NATIVE}.getAttribute('data-supertweet-hidden') === '1' && ${NATIVE}.getAttribute('aria-hidden') === 'true' && getComputedStyle(${NATIVE}).display === 'none'`));
check('drawer Post starts disabled', (await postBtn()).disabled && /Write something/.test((await postBtn()).label), JSON.stringify(await postBtn()));

await type('SLOW We tracked first-attempt success across 40 quickstarts and it changed how we staff DevRel.');
check('locked while grading', Boolean(await until(`/Grading/.test(${SR}.querySelector('.st-score').textContent)`, 2000)) && (await postBtn()).disabled, await status());
await waitStatus(/9\.0/, 6000);
const t1 = await panelText();
check('Developer Trust: 9.0, the Sweet bucket and its one-line why; Serving shows the objective for context', await ev(`${SR}.querySelector('.st-obj select').selectedOptions[0].textContent`) === 'Ecosystem leader who measures' && /9\.0/.test(t1) && await ev(`${SR}.querySelector('.st-bucket .seg.on').textContent`) === 'Sweet' && /specific learning/.test(t1), t1);
check('no audiences, people or personas anywhere in the drawer', !/Audiences|Personas|People|Resonates/.test(t1));
check('drawer Post unlocks as "Post to LinkedIn"', !(await postBtn()).disabled && (await postBtn()).label === 'Post to LinkedIn', JSON.stringify(await postBtn()));
check('ready: no Get to 8 card, no edits list', !(await ev(`!!${SR}.querySelector('.st-card')`)) && !/Edits for this objective|Upgraded version/.test(t1));
check('no algorithm line on LinkedIn', !/X algorithm/.test(t1) && !(await ev(`!!${SR}.querySelector('.st-algo')`)));
check('request: score only, platform linkedin, deterministic checks, no personas or audience sets', lastReq().platform === 'linkedin' && !requests.some((r) => r.mode === 'suggest') && lastReq().checks.words > 5 && !('personas' in lastReq()) && !('audience_set_id' in lastReq()));

await clickIn('.st-post');
await until(`/Posted/.test(${SR}.querySelector('.st-foot').textContent)`, 4000);
check('drawer Post clicks the hidden native button and confirms it went out', /SENT:Post/.test(await sent()) && /Posted/.test(await ev(`${SR}.querySelector('.st-foot').textContent`)), await sent());
check('posted draft saved for the dashboard as passed', await ev(`(window.__saved || []).some((r) => r.gate_result === 'passed' && r.posted_at)`));

await type('We tracked first-attempt success across 40 quickstarts.');
await waitStatus(/9\.0/);
await send('Input.insertText', { text: ' x' });
await sleep(50);
check('editing after a pass re-locks', (await postBtn()).disabled, JSON.stringify(await postBtn()));

// ---------- Gate states ----------
await type('LOW post about developer adoption metrics.');
check('below 8 (Low): locked with the score in the button', Boolean(await waitPost(/^3\.0 \/ 10, needs 8\+$/)) && await ev(`${SR}.querySelector('.st-bucket .seg.on').textContent`) === 'Low', JSON.stringify(await postBtn()));
await until(`!!${SR}.querySelector('a[href="#override"]')`, 3000);
await clickIn('a[href="#override"]');
await typeReason('input[data-override]', 'short');
check('a reason needs 8+ characters', await ev(`${SR}.querySelector('[data-act=unlock]').disabled`));
await typeReason('input[data-override]', 'This is for a specific thread with context');
await ev(`${SR}.querySelector('input[data-override]').blur()`);
await clickIn('[data-act=unlock]');
check('typed reason unlocks this draft (Post anyway)', Boolean(await until(`!${SR}.querySelector('.st-post').disabled && ${SR}.querySelector('.st-post').classList.contains('over')`, 3000)));
const ovr = await ev(`JSON.parse(localStorage.getItem('st-store')).overrides.slice(-1)[0]`);
check('override logged locally with reason, score, kind and hash', ovr && ovr.reason.startsWith('This is') && ovr.kind === 'score' && Boolean(ovr.hash) && ovr.score === 3, JSON.stringify(ovr));

await type('OFF reacting to some industry news today.');
await waitPost(/needs 8\+/);
check('no objective match no longer locks by itself: it\'s just a low trust score, with "Post anyway, with a reason"', !(await ev(`${SR}.querySelector('.st-obj').classList.contains('off')`)) && Boolean(await until(`!!${SR}.querySelector('a[href="#override"]')`, 3000)));

await type('RISKY post naming a competitor as dishonest.');
check('high-confidence lawyer kill locks, shown as a flag', Boolean(await waitPost(/Lawyer: risky to post/)) && /Lawyer: Reads as defamatory/.test(await ev(`${SR}.querySelector('.st-flag[data-flag=lawyer]').textContent`)));

await type('FAIL this one please.');
check('grader failure: "Grader offline", locked, Post anyway offered', Boolean(await waitPost(/Grader offline/)) && Boolean(await until(`!!${SR}.querySelector('a[href="#override"]')`, 3000)));

await type('NOPROOF agents need better docs to succeed with onboarding.');
await waitStatus(/5\.0/);
check('Middle with nothing worth adding: "Ready as written" with a one-line reason; Post says the score', Boolean(await waitPost(/^5\.0 \/ 10, needs 8\+$/)) && /Ready as written/.test(await panelText()), await panelText());

// ---------- Privacy (TMI) ----------
await type('We measured onboarding time across 40 teams. Final round tomorrow.');
check('warn question: locked until answered', Boolean(await waitPost(/Answer 1 privacy question/)));
await clickIn('.st-flag [data-act=keep]');
await waitStatus(/9\.0/);
check('"Keep, it\'s intentional" answers it', !(await postBtn()).disabled, JSON.stringify(await postBtn()));
await ev(`(() => { const e = document.querySelector('[role=textbox][contenteditable]'); e.focus(); const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
await send('Input.insertText', { text: ' The recruiters keep calling.' });
check('kept answers are tied to the exact words: new matches ask again', Boolean(await waitPost(/Answer 1 privacy question/)), JSON.stringify(await postBtn()) + ' | ' + await ev(`document.querySelector('[role=textbox]').innerText`));

await type('We measured adoption before the custody hearing.');
await waitPost(/privacy question/);
await typeReason('.st-flag[data-flag=legal] input', 'Already public record');
await clickIn('.st-flag[data-flag=legal] [data-act=keep-reason]');
await waitPost(/^Post to LinkedIn$/);
check('high (legal) needs a typed reason to keep', !(await postBtn()).disabled, JSON.stringify(await postBtn()) + (await panelText()).slice(0, 300));

await type('Email me at pat@example.com about the onboarding numbers.');
check('contact info blocks with no override', Boolean(await waitPost(/Remove the contact info/)) && !(await ev(`!!${SR}.querySelector('a[href="#override"]')`)) && /hidden/.test(await ev(`${SR}.querySelector('.st-flag[data-flag=contact]').innerText`)) && !(await panelText()).includes('pat@example.com'));
await clickIn('.st-flag[data-flag=contact] [data-act=remove]');
await sleep(150);
check('"Remove" strips it from the draft', !(await ev(`document.querySelector('[role=textbox]').innerText`)).includes('pat@example.com'));

await ev(`chrome.storage.local.set({ privateTerms: ['Project Falcon'] })`);
await sleep(300);
await type('We shipped Project Falcon onboarding and measured first-attempt success.');
check('private terms block', Boolean(await waitPost(/Remove your private term/)));
await sleep(1200);
check('private terms never reach the grader (masked)', /\[PRIVATE\]/.test(lastReq().post_text) && !/Falcon/.test(JSON.stringify(requests.slice(-4))), lastReq().post_text);
await ev(`chrome.storage.local.set({ privateTerms: [] })`);
await sleep(300);

await type('CAR we measured onboarding again, third night in the car though.');
check('grader backstop: implied disclosures become warn questions', Boolean(await until(`/Do you want people to know where you sleep/.test(${SR}.querySelector('.st-panel').innerText)`, 5000)) && Boolean(await waitPost(/privacy question/)));

await type('We cut onboarding time by [YOUR NUMBER] after the docs rewrite.');
check('placeholders block until replaced (the label never repeats the placeholder)', Boolean(await waitPost(/^Replace the placeholder$/)));

await type('Some people are clowns for still writing docs by hand.');
check('a trust kill locks Post and names the category; only "Post anyway, with a reason" gets past it', Boolean(await waitPost(/^Kill: personal or veiled attack$/)) && await ev(`!!${SR}.querySelector('.st-flag.block[data-flag=kill]') && !!${SR}.querySelector('a[href="#override"]')`));

// ---------- Objective chip ----------
await type('We measured agent onboarding across 40 runs.');
await waitStatus(/9\.0/);
await ev(`(() => { const s = ${SR}.querySelector('.st-obj select'); s.value = 'agent-builder'; s.dispatchEvent(new Event('change')); })()`);
await until(`${SR}.querySelector('.st-obj select').selectedOptions[0].textContent === 'Hands-on agent builder' && ${SR}.querySelector('.st-score .n').textContent === '9.0'`, 5000);
check('the Serving select overrides which objective the draft is for', lastReq().objective_id === 'agent-builder', lastReq().objective_id);

// ---------- Every other send path ----------
await type('LOW still locked.');
await waitPost(/needs 8/);
const before = ((await sent()).match(/SENT/g) || []).length;
await ev(`document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.metaKey) document.getElementById('log').textContent += 'KEY-REACHED-PAGE\\n'; })`);
await ev(`document.querySelector('[role=textbox]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 4, windowsVirtualKeyCode: 13 });
await sleep(100);
check('Cmd+Enter is blocked', !/KEY-REACHED-PAGE/.test(await sent()));
await ev(`${NATIVE}.click()`);
check('clicking the hidden native button directly does nothing', ((await sent()).match(/SENT/g) || []).length === before);
await ev('window.__rerenderButton()');
await sleep(250);
check('native button stays hidden when React re-mounts it', await ev(`${NATIVE}.getAttribute('data-supertweet-hidden') === '1'`));

// ---------- Failed post gives the native button back ----------
await type('We tracked first-attempt success across 40 quickstarts again.');
await waitPost(/^Post to LinkedIn$/);
await ev('window.__failNextPost = true');
await clickIn('.st-post');
const failed = await until(`/didn't go through/.test(${SR}.querySelector('.st-foot').textContent)`, 12000);
check('"Post didn\'t go through" restores the native button', Boolean(failed) && await ev(`!${NATIVE}.hasAttribute('data-supertweet-hidden')`));
await ev('window.__failNextPost = false');

// ---------- Drawer behavior ----------
check('the drawer scrolls inside itself', await ev(`getComputedStyle(${SR}.querySelector('.p')).overflowY === 'auto'`));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(150);
check('Escape closes the drawer back to the bubble', await ev(`${SR}.querySelector('.p').hidden && !${SR}.querySelector('.bubble').hidden`));
await ev(`(() => { const b = ${SR}.querySelector('.bubble'); const r = b.getBoundingClientRect(); const e = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 3 }));
  e('pointerdown', r.x + 10, r.y + 10); e('pointermove', r.x - 200, r.y - 200); e('pointerup', r.x - 200, r.y - 200); })()`);
check('the bubble can be dragged out of the way, and remembers where', await ev(`JSON.parse(localStorage.getItem('supertweet:panel')).bx < innerWidth - 100`));

// ---------- Comments ----------
await go('/comments/', 800);
await type('We measured agent onboarding across 40 runs for this.', '.comments-comment-texteditor [contenteditable]');
await sleep(150);
await ev(`document.querySelector('.comments-comment-texteditor [contenteditable]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(100);
check('comments: Enter-to-send is blocked', !/SENT:EnterComment/.test(await sent()), await sent());
await ev(`document.querySelector('form.comments-comment-box__form').requestSubmit()`);
await sleep(100);
check('comments: form submit is blocked', !/SENT:Submit/.test(await sent()), await sent());
check('comments: native Comment button hidden, drawer button says Comment', await ev(`document.querySelector('.comments-comment-box__submit-button').getAttribute('data-supertweet-hidden') === '1'`) && Boolean(await waitPost(/^Comment$/, 6000)), JSON.stringify(await postBtn()));

// ---------- Missing native button ----------
await go('/feed/', 1300);
await ev(`document.querySelector('.share-actions__primary-action').remove()`);
await type('We measured agent onboarding across 40 runs.');
await sleep(300);
check("can't find the native button: the drawer says so and hides nothing", /Can't find LinkedIn's/.test((await postBtn()).label), JSON.stringify(await postBtn()));
await ev(`document.querySelector('[role=textbox]').focus()`);
await ev(`window.__keySeen = false; document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.metaKey) window.__keySeen = true; })`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 4, windowsVirtualKeyCode: 13 });
check('…and leaves native keyboard behavior alone', await ev('window.__keySeen'));

// ---------- Article editor ----------
await go('/article/new/', 500);
check('article: Next is hidden', Boolean(await until(`document.querySelector('.article-editor-nav button').getAttribute('data-supertweet-hidden') === '1'`, 3000)));
await ev(`(() => { const t = document.querySelector('.article-editor-headline__textarea'); t.value = 'Two DevRel jobs, two metrics'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await type('An essay body with a thesis and a test you can run.', '.article-editor-content [contenteditable]');
await waitPost(/^Next$/, 6000);
check('article: title sent, drawer button says Next', lastReq().title === 'Two DevRel jobs, two metrics' && (await postBtn()).label === 'Next', JSON.stringify(lastReq().title));

// ---------- Past posts ----------
const beforePast = requests.length;
await go('/in/demo_dev/recent-activity/all/', 300);
const b1 = await until(`(() => { const h = document.querySelector('[data-urn="urn:li:activity:1001"] [data-supertweet=past-badge]'); return h && /\\/10/.test(h.shadowRoot.textContent) ? h.shadowRoot.textContent : null; })()`, 6000);
const b2 = await ev(`!!document.querySelector('[data-urn="urn:li:activity:1002"] [data-supertweet=past-badge]')`);
check('own past posts badged with the trust score, bucket and why', /9\.0\/10/.test(b1) && /Sweet/.test(b1) && /specific learning/.test(b1), b1);
check("someone else's repost isn't graded", !b2 && requests.slice(beforePast).every((r) => !/repost of someone else/.test(r.post_text)));
const graded = requests.length - beforePast;
await go('/in/demo_dev/recent-activity/all/', 1500);
check('re-visits use the cache (no re-grade); badges use the score call only', requests.length - beforePast === graded && graded === 2 && requests.slice(beforePast).every((r) => r.mode === 'score'), `${requests.length - beforePast}`);
const csv = await ev(`window.SupertweetPastPosts.buildCsv()`);
check('CSV export: score, bucket, why per post, and a per-bucket summary', /urn,url,score,bucket,why,kill,override_reason,text/.test(csv) && /bucket,posts,avg_score/.test(csv) && /sweet,\d+,/.test(csv), csv);
check('export button on your activity page', await ev(`!!document.querySelector('[data-supertweet=li-export]')`));

// ---------- Edited objectives apply without reload ----------
await go('/feed/', 1300);
await ev(`fetch('/config/objectives.json').then((r) => r.json()).then((doc) => { doc.objectives.push({ ...doc.objectives[0], id: 'brand-new-objective', statement: 'A new one.' }); return chrome.storage.local.set({ objectivesOverride: doc }); })`);
await type('We measured agent onboarding across 40 runs.');
check('edited objectives show up in the Serving select live', Boolean(await until(`[...${SR}.querySelectorAll('.st-obj option')].some((o) => o.value === 'brand-new-objective')`, 5000)));

process.exit(close() ? 1 : 0);
