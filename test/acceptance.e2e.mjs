// End-to-end acceptance for the score panel on the X fixture, with the real grading pipeline
// (server/pipeline.mjs) on the mock model: the Developer Trust filter, the reference layout
// (docs/spec/panel-ref/ACCEPTANCE.md, updated for the trust bucket bar and the X row), manual grading,
// the grader upgrade (2 steps max, 1.0+, pairwise, app data, skip, thumbs-down, median, cache,
// unstable), Tune for X, Details, kills, and the drawer layout. Check 11 (web app) is in web.e2e.mjs.
// Run: node test/acceptance.e2e.mjs   (SHOT_DIR=… saves screenshots)
import { startEnv, USER_DRAFT, ONE_LINE_DRAFT, HALF_DRAFT, GRADE_DRAFT, KILL_FIXTURES } from './env.mjs';
import { writeFileSync } from 'node:fs';

const SHORT = USER_DRAFT.replace("I know there are a bunch of algorithm rules and best practices, but I don't want to have to apply them manually", "I know the algorithm rules exist, but I don't want to apply them by hand");
const { ev, go, check, close, until, sleep, requests, send } = await startEnv({ port: 8796, cdpPort: 9346 });
const SR = `document.querySelector('[data-supertweet=panel]').shadowRoot`;
const ED = `document.querySelector('[data-testid=tweetTextarea_0]')`;
const panelText = () => ev(`${SR}.querySelector('.st-panel').innerText`);
const postLabel = () => ev(`${SR}.querySelector('.st-post').textContent.trim()`);
const postEnabled = () => ev(`!${SR}.querySelector('.st-post').disabled`);
const draft = () => ev(`${ED}.innerText`);
const scoreN = () => ev(`${SR}.querySelector('.st-score .n').textContent`);
const grades = () => requests.filter((r) => r.route === '/grade').length;
// Press Grade and make sure grading started (the panel may re-render under the click once).
const pressGrade = async () => {
  await until(`!!${SR}.querySelector('[data-act=grade]')`, 4000);
  for (let i = 0; i < 4; i++) {
    await ev(`(() => { const b = ${SR}.querySelector('[data-act=grade]'); if (b) b.click(); })()`);
    if (await until(`!${SR}.querySelector('[data-act=grade]')`, 600)) return;
  }
};
const setDraft = async (t, { grade = true } = {}) => { await ev(`(() => { const e = ${ED}; e.focus(); e.textContent = ${JSON.stringify(t)}; e.dispatchEvent(new InputEvent('input', { bubbles: true })); })()`); if (grade) await pressGrade(); };
const bodyOrder = () => ev(`[...${SR}.querySelector('.st-body').children].map((c) => c.className.split(' ')[0])`);
const outerOrder = () => ev(`[...${SR}.querySelector('.st-panel').children].map((c) => c.className.split(' ')[0])`);
const steps = () => ev(`[...${SR}.querySelectorAll('.st-step')].map((s) => ({ title: s.querySelector('.r b').textContent, pts: s.querySelector('.r span').textContent, why: s.querySelector('p').textContent, actions: s.querySelectorAll('.st-act').length, skip: !!s.querySelector('[data-act=skip]'), reject: !!s.querySelector('[data-act=reject]') }))`);
const media = (on) => ev(`document.getElementById('media-slot').innerHTML = ${on ? `'<div data-testid="attachments"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>'` : "''"}`);
const NO_PLACEHOLDER = /\[[A-Z]/;
const shoot = async (name) => { if (!process.env.SHOT_DIR) return; await ev('document.fonts.ready.then(() => 1)'); await sleep(300); const { result } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${process.env.SHOT_DIR}/${name}`, Buffer.from(result.data, 'base64')); };

await go('/home');
await ev('localStorage.clear()');
await ev(`localStorage.setItem('supertweet:panel', JSON.stringify({ open: true }))`);
await go('/home');

// ---------- Manual grading ----------
const g0 = grades();
await setDraft(USER_DRAFT, { grade: false });
await sleep(1200);
check('grading waits for you: no grader call while typing; Grade button; "Grade to post"', grades() === g0 && await ev(`${SR}.querySelector('[data-act=grade]').textContent`) === 'Grade' && (await postLabel()) === 'Grade to post');
check('fixture: your exact draft, line breaks included', (await draft()) === USER_DRAFT);
await pressGrade();
await until(`${SR}.querySelector('.st-score .n').textContent === '5.0' && !!${SR}.querySelector('.st-card')`, 8000);
const locked = await panelText();

// ---------- Layout (ACCEPTANCE 1-3, with the trust bucket bar) ----------
check('1. order: header, Serving, score + pill, trust bar + why, Get to 8, safety line, X algorithm row, footer',
  JSON.stringify(await outerOrder()) === '["st-head","st-body","st-foot"]' && JSON.stringify(await bodyOrder()) === '["st-obj","st-score","st-trust","st-card","st-safe","st-algo"]', JSON.stringify(await bodyOrder()));
check('2. the objective appears once (Serving select); no Auto-detect, no objective sentence',
  await ev(`${SR}.querySelectorAll('select').length`) === 1 && await ev(`(() => { const c = ${SR}.querySelector('.st-panel').cloneNode(true); c.querySelector('select').remove(); return !/Hands-on agent builder|Auto-detect|Build credibility/.test(c.textContent); })()`));
check('3. one big score "5.0", "/10", "Locked · needs 8+", not repeated', await scoreN() === '5.0' && /Locked · needs 8\+/.test(locked) && (locked.match(/5\.0/g) || []).length === 1, locked);
check('trust bar: Kill | Low | Middle | Sweet, Middle highlighted, a marker at the score, the one-line why under it',
  await ev(`[...${SR}.querySelectorAll('.st-bucket .seg')].map((s) => s.textContent).join('|')`) === 'Kill|Low|Middle|Sweet'
  && await ev(`${SR}.querySelector('.st-bucket .seg.on').textContent`) === 'Middle' && await ev(`!!${SR}.querySelector('.st-bucket .mk')`)
  && /shows no work/.test(await ev(`${SR}.querySelector('.st-why').textContent`)));

// ---------- Steps (grader upgrade) ----------
const s1 = await steps();
check('steps: at most 2, each 1.0+, title, points, why, one primary action; 👎 on every step, Skip on questions',
  s1.length === 2 && s1.every((s) => Number(s.pts) >= 1 && s.title && s.why && s.actions === 1 && s.reject) && s1.find((s) => s.title === 'Put a number on it').skip && await ev(`${SR}.querySelector('.st-card .h span').textContent`) === '2 steps, +4.0', JSON.stringify(s1));
check('pairwise check: the edit that reads worse ("won\'t apply") was dropped; the [LINK TO REPO] step too', !/Tighten line two|Add the repo/.test(locked));
check('5. missing proof is "Attach screenshot" (+3.0); "Add proof to post"', s1[0].title === 'Show the thing' && s1[0].pts === '+3.0' && (await postLabel()) === 'Add proof to post');
await ev(`${SR}.querySelector('[data-act=attach]').click()`);
check('5. "Attach screenshot" opens X\'s own media picker', await ev('window.__pickerOpened') === 1);
check('6. no "[" placeholder in the panel, the draft or the Post button', !NO_PLACEHOLDER.test(locked) && !NO_PLACEHOLDER.test(await draft()) && !NO_PLACEHOLDER.test(await postLabel()));
check('10. X row: "X algorithm N (advisory)", Tune for X, Details; no meter',
  /^X algorithm \d+\.\d \(advisory\)$/.test(await ev(`${SR}.querySelector('.st-algo span').textContent`)) && await ev(`[...${SR}.querySelectorAll('.st-algo button')].map((b) => b.textContent).join('|')`) === 'Tune for X|Details' && await ev(`${SR}.querySelectorAll('.meter, meter, progress').length`) === 0);

// 7. ask_fact: optional, labeled, one line, char limit
const askSel = `[...${SR}.querySelectorAll('.st-step')].find((s) => s.querySelector('input'))`;
check('7. ask_fact: labeled input and a one-line before/after; Apply disabled until answered',
  await ev(`(() => { const s = ${askSel}; const i = s.querySelector('input'); return s.querySelector('label').htmlFor === i.id && i.placeholder === 'e.g. 6'; })()`) && await ev(`${askSel}.querySelector('[data-act=apply]').disabled`));
const typeAnswer = async (v) => { await ev(`(() => { const i = ${askSel}.querySelector('input'); i.focus(); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); })()`); await sleep(100); };
await typeAnswer('6');
check('7. your draft is 283 characters: even a short answer is over 280, Apply stays disabled and says by how much', await ev(`${askSel}.querySelector('[data-act=apply]').disabled`) && /characters over/.test(await ev(`${askSel}.textContent`)));
// Skip: removes the question, never changes the score
const gSkip = grades();
await ev(`${askSel}.querySelector('[data-act=skip]').click()`);
await sleep(300);
check('Skip, I don\'t have this: the question is gone, the score is unchanged, no new grading call', !(await ev(`!!${askSel}`)) && await scoreN() === '5.0' && grades() === gSkip);

// 8. Applying a step edits only that line (shorter variant fits in 280). A skip lasts for the
// compose session, so start a new one.
await go('/home');
await setDraft(SHORT);
await until(`!!${askSel} && ${SR}.querySelector('.st-score .n').textContent === '5.0'`, 8000);
await typeAnswer('6');
check('7. Apply is enabled once there is an answer that fits', !(await ev(`${askSel}.querySelector('[data-act=apply]').disabled`)));
const before = await draft();
await ev(`${askSel}.querySelector('[data-act=apply]').click()`);
await sleep(400);
const after = await draft();
const A = before.split('\n'), B = after.split('\n');
check('8. Apply changes only the last line; every other line and every line break is byte-identical',
  A.length === B.length && A.every((l, i) => (i === A.length - 1 ? l !== B[i] : l === B[i])) && B[B.length - 1] === "biggest surprise so far: I'm bad at this, even after 6 hours of building it.", JSON.stringify(after));
await pressGrade();
await until(`${SR}.querySelector('.st-score .n').textContent === '6.0'`, 8000);
await media(true);
await pressGrade();
await until(`${SR}.querySelector('.st-pill').textContent === 'Ready'`, 8000);
check('3/12. with a screenshot: 9.0, Sweet, "Ready", "Post to X"; no Get to 8 card', await scoreN() === '9.0' && (await postLabel()) === 'Post to X' && await postEnabled() && JSON.stringify(await bodyOrder()) === '["st-obj","st-score","st-trust","st-safe","st-algo"]');
await setDraft(USER_DRAFT);
await until(`${SR}.querySelector('.st-score .n').textContent === '8.0'`, 8000);
check('gate: exactly 8.0 is Ready (Sweet) and Post unlocks', await ev(`${SR}.querySelector('.st-pill').textContent`) === 'Ready' && await postEnabled() && await ev(`${SR}.querySelector('.st-bucket .seg.on').textContent`) === 'Sweet');
await media(false);

// ---------- Same draft, same score ----------
await setDraft(SHORT);
await until(`!${SR}.querySelector('[data-act=grade]') && ${SR}.querySelector('.st-score .n').textContent === '5.0'`, 8000);
const gSame = grades();
await setDraft(`${SHORT} x`, { grade: false });
await sleep(200);
await setDraft(SHORT, { grade: false });
await sleep(400);
check('the same draft graded twice shows the same score, from the cache (no new grading call)', await scoreN() === '5.0' && grades() === gSame && !(await ev(`!!${SR}.querySelector('[data-act=grade]')`)));

// ---------- 👎 Bad advice ----------
await ev(`[...${SR}.querySelectorAll('.st-step')].find((s) => /Show the thing/.test(s.textContent)).querySelector('[data-act=reject]').click()`);
await sleep(300);
const rejected = await ev(`JSON.parse(localStorage.getItem('st-store')).rejectedSteps`);
check('👎 removes the step and remembers it', !/Show the thing/.test(await panelText()) && rejected.length === 1 && rejected[0].title === 'Show the thing');
await setDraft(SHORT.replace('X makes no sense to me', 'X still makes no sense to me'));
await until(`!${SR}.querySelector('[data-act=grade]') && ${SR}.querySelector('.st-score .n').textContent !== '–'`, 8000);
const lastGrade = [...requests].reverse().find((r) => r.route === '/grade');
check('…and the grader gets it in "avoid" (the last 10 rejected steps and overrides)', lastGrade.avoid.some((a) => a.kind === 'rejected_step' && a.title === 'Show the thing') && !/Show the thing/.test(await panelText()));

// ---------- Your draft, with your Supertweet data ----------
await setDraft(GRADE_DRAFT);
await until(`${SR}.querySelector('.st-score .n').textContent === '6.0' && !!${SR}.querySelector('.st-card')`, 8000);
const gd = await steps();
const stats = (await ev(`JSON.parse(localStorage.getItem('st-store')).gradeLog`)).length;
check('no ask_fact for a number the app has: the draft count is filled in from your data, as an edit you can take or leave',
  !(await ev(`!!${SR}.querySelector('.st-step input')`)) && gd.some((s) => s.title === 'Say how many') && /From your Supertweet data/.test(await panelText()) && /My \d+ drafts average 5\.1\/10\./.test(await panelText()) && stats > 0, JSON.stringify(gd));
check('dropped: the tone-flattening punchline edit, the 0.5 nitpick, the longer-only edit', !/Tighten the punchline|Comma|Add context/.test(await panelText()));
await shoot('trust-panel-grade-draft.png');

// ---------- Why this score (the critique, in the panel) ----------
await ev(`${SR}.querySelector('[data-act=critique]').click()`);
await until(`!!${SR}.querySelector('.st-crit .cr')`, 8000);
const crit = await ev(`${SR}.querySelector('.st-crit').innerText`);
const critQuotes = await ev(`[...${SR}.querySelectorAll('.st-crit q')].map((q) => q.textContent)`);
check('Why this score: works, costs, pushback, how to get to 8, breakdown; every quote is in your draft', /What works/.test(crit) && /What costs points/.test(crit) && /Pushback/.test(crit) && /Shows building \d+ · Specific \d+ · Useful to a developer \d+ · Voice \d+/.test(crit) && critQuotes.length >= 1 && critQuotes.every((q) => GRADE_DRAFT.includes(q)), crit);
check('the trust score stays the score: the breakdown explains it', await scoreN() === '6.0');
await shoot('trust-panel-critique.png');
await ev(`${SR}.querySelector('[data-act=critique]').click()`);
await sleep(200);

// ---------- Tune for X ----------
await ev(`${SR}.querySelector('[data-act=tune]').click()`);
await until(`!!${SR}.querySelector('[data-tune]')`, 8000);
const tuneText = await ev(`${SR}.querySelector('.st-tune').textContent`);
check('Tune for X: both scores before anything changes ("X algorithm a → b, objective x → y"), a per-line diff, Accept and Undo',
  /X algorithm \d+\.\d → \d+\.\d, objective 6\.0 → 6\.0/.test(tuneText) && await ev(`${SR}.querySelectorAll('.st-tune .st-diff').length`) >= 1 && /Accept/.test(tuneText) && (await draft()) === GRADE_DRAFT, tuneText);
await shoot('trust-panel-tune.png');
await ev(`${SR}.querySelector('[data-act=tune-accept]').click()`);
await sleep(400);
const tuned = await draft();
check('Accept applies it: no invented numbers (the 47% edit was dropped), within 280, line breaks kept, the trust score didn\'t drop',
  tuned !== GRADE_DRAFT && !/47%/.test(tuned) && [...tuned].length <= 280 && tuned.split('\n').length === GRADE_DRAFT.split('\n').length && Number(await scoreN()) >= 6, tuned);
await ev(`${SR}.querySelector('[data-act=tune-undo]').click()`);
await sleep(300);
check('Undo restores the original exactly', (await draft()) === GRADE_DRAFT);

// ---------- Details ----------
await ev(`${SR}.querySelector('[data-act=details]').click()`);
await until(`!!${SR}.querySelector('.st-pass') && !/Reading your draft/.test(${SR}.querySelector('.st-checks').textContent)`, 8000);
const det = await ev(`${SR}.querySelector('.st-checks').innerText`);
const RULES = await ev(`fetch('/config/x-algorithm-rules.json').then((r) => r.json())`);
const generic = (RULES.rules || []).map((r) => r.fix).filter(Boolean).concat(['Add the concrete artifact: a number, steps, a test, or the repo.', 'Say what you built, ran or tested.', 'Wait a few hours or fold this into your earlier post.']);
check('Details: at most 3 rows plus one "N checks pass." line; each row quotes the draft or names what\'s missing, with a rewritten line and Fix',
  await ev(`${SR}.querySelectorAll('.st-check').length`) <= 3 && /\d+ checks? pass\./.test(det) && await ev(`[...${SR}.querySelectorAll('.st-check')].every((r) => r.querySelector('.st-diff') && r.querySelector('[data-act=fix-check]'))`), det);
check('Details: no generic fix text', generic.every((g) => !det.includes(g)), det);
await ev(`${SR}.querySelector('[data-act=fix-check]').click()`);
await sleep(300);
check('Fix applies just that change (one line)', (await draft()).split('\n').filter((l, i) => l !== GRADE_DRAFT.split('\n')[i]).length === 1);
await ev(`${SR}.querySelector('[data-act=undo]').click()`);
await sleep(200);

// ---------- Kills ----------
await setDraft(KILL_FIXTURES['politics or culture war'], { grade: false });
await sleep(400);
check('kill (on-device, instant): red block naming the category and quoting the span; Post locked', await ev(`!!${SR}.querySelector('.st-flag.block[data-flag=kill]')`) && /Kill: politics or culture war/.test(await panelText()) && /“woke”/.test(await panelText()) && (await postLabel()) === 'Kill: politics or culture war' && !(await postEnabled()));
await ev(`${SR}.querySelector('a[href="#override"]').click()`);
await ev(`(() => { const i = ${SR}.querySelector('input[data-override]'); i.value = 'Quoting someone else on purpose'; i.dispatchEvent(new Event('input')); i.blur(); })()`);
await ev(`${SR}.querySelector('[data-act=unlock]').click()`);
await pressGrade(); // a reason covers this exact draft; it still gets graded (a kill, overridden)
await until(`!${SR}.querySelector('.st-post').disabled`, 8000);
check('"Post anyway" needs a typed reason, and it\'s logged', await postEnabled() && (await ev(`JSON.parse(localStorage.getItem('st-store')).overrides.slice(-1)[0]`)).kind === 'kill');
await setDraft(KILL_FIXTURES['repeating the same point']);
await until(`${SR}.querySelector('.st-post').textContent.trim() === 'Kill: repeating the same point'`, 8000);
check('kill (grader): "repeating the same point" scores 0, Kill highlighted, Post locked', await ev(`${SR}.querySelector('.st-bucket .seg.on').textContent`) === 'Kill' && (await postLabel()) === 'Kill: repeating the same point' && !(await postEnabled()), `${await postLabel()} | ${await panelText()}`.slice(0, 400));

// ---------- Unstable ----------
await setDraft('Our agent eval harness caught a regression today UNSTABLE');
await until(`/Unstable score/.test(${SR}.querySelector('.st-pill').textContent)`, 8000);
check('three grades more than 1.0 apart: "Unstable score", and it doesn\'t lock you out', await postEnabled() && /disagreed by/.test(await panelText()), `${await postLabel()} | ${await panelText()}`.slice(0, 400));

// ---------- Nothing clears the bar ----------
await media(true);
await setDraft(HALF_DRAFT);
await until(`!!${SR}.querySelector('.st-asis')`, 8000);
check('no step worth 1.0+: "Ready as written" with a one-line reason, no invented tweaks', !(await ev(`!!${SR}.querySelector('.st-step')`)) && /Ready as written/.test(await panelText()));
await media(false);

// ---------- Layout: the drawer never covers the draft ----------
await setDraft(ONE_LINE_DRAFT);
await until(`${SR}.querySelector('.st-score .n').textContent !== '–'`, 8000);
const overlap = () => ev(`(() => { const d = ${SR}.querySelector('.p').getBoundingClientRect(); const c = document.getElementById('col').getBoundingClientRect(); const e = ${ED}.getBoundingClientRect();
  const hit = document.elementFromPoint(e.right - 4, e.top + 8); return { gap: d.left - c.right, editorOnTop: ${ED}.contains(hit) || hit === ${ED}, shift: document.documentElement.style.getPropertyValue('--supertweet-shift') }; })()`);
const wide = await overlap();
check('layout (1400px): the drawer docks beside the composer', wide.gap >= 0 && wide.editorOnTop && !wide.shift, JSON.stringify(wide));
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
const narrow = await overlap();
check('layout (1000px): the composer column shifts left; nothing covers the draft', narrow.gap >= 0 && narrow.editorOnTop && Boolean(narrow.shift), JSON.stringify(narrow));
await send('Emulation.clearDeviceMetricsOverride');

// ---------- Your draft, in dark mode, for the screenshot ----------
if (process.env.SHOT_DIR) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1300, deviceScaleFactor: 1, mobile: false });
  await setDraft(GRADE_DRAFT, { grade: false });
  await sleep(600);
  await shoot('trust-panel-final.png');
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setEmulatedMedia', { features: [] });
}

// ---------- The reference fixtures, through the ported component ----------
await go('/test/fixtures/panel.html', 800);
const ref = (id) => ev(`[...document.querySelectorAll('#${id} .st-body > *')].map((c) => c.className.split(' ')[0])`);
check('reference fixture A (locked) renders in order with the trust bar', JSON.stringify(await ref('a')) === '["st-obj","st-score","st-trust","st-card","st-safe","st-algo"]' && await ev(`document.querySelector('#a .st-post').textContent`) === 'Add proof to post');
check('reference fixture B (ready)', JSON.stringify(await ref('b')) === '["st-obj","st-score","st-trust","st-safe","st-algo"]' && await ev(`document.querySelector('#b .st-post').textContent`) === 'Post to X');
await ev(`document.querySelector('#a [data-act=apply]:not([disabled])').click()`);
const ap = await ev('window.__applied[0]');
check('8. reference line_edit: only that line changes, line breaks byte-identical', (() => { const a = ap.before.split('\n'), b = ap.after.split('\n'); return a.length === b.length && a.filter((l, i) => l !== b[i]).length === 1; })(), JSON.stringify(ap));

process.exit(close() ? 1 : 0);
