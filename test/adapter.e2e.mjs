// Adapter tests: every PlatformAdapter method against the X and LinkedIn fixtures.
// Run: node test/adapter.e2e.mjs
import { startEnv } from './env.mjs';

const { ev, go, check, close, until, send } = await startEnv({ port: 8768, cdpPort: 9336 });
const call = (platform, body) => ev(`(() => { const A = window.SupertweetAdapters.${platform}; ${body} })()`);

// ---------- X ----------
await go('/home');
await ev('localStorage.clear()');
await ev(`localStorage.setItem('st-store', JSON.stringify({ settings: { myHandles: ['demo_team'] } }))`); // "Your other X handles" in the popup
await go('/home');
check('X: matches() takes x.com and twitter.com, not linkedin', await call('x', `return [A.matches('https://x.com/home'), A.matches('https://twitter.com/a'), A.matches('https://www.linkedin.com/feed/')].join()`) === 'true,true,false');
check('X: platform picked for the page', await ev('window.SupertweetPlatform.id') === 'x');
check('X: findComposer() finds the compose box', await call('x', `return A.findComposer().length`) === 1);
await ev(`(() => { const t = document.querySelector('[data-testid=tweetTextarea_0]'); t.focus(); })()`);
await send('Input.insertText', { text: 'hello draft' });
check('X: readDraft() returns text, no title', await call('x', `const d = A.readDraft(A.findComposer()[0]); return d.text + '|' + d.title`) === 'hello draft|null');
check('X: buttonFor/composersFor round-trip', await call('x', `const c = A.findComposer()[0]; return A.composersFor(A.buttonFor(c))[0] === c`));
check('X: sendLabel() reads the native button', await call('x', `return A.sendLabel(A.buttonFor(A.findComposer()[0]))`) === 'Post');
check('X: composerMedia() and isReplyComposer() on a plain post', await call('x', `const c = A.findComposer()[0]; return A.composerMedia(c).media + '|' + A.isReplyComposer(c)`) === 'none|false');
check('X: profileFacts() finds when you last posted', await call('x', `const f = A.profileFacts(); return f && f.lastPostAt.slice(0, 10)`) === '2026-03-03');
check('X: findOwnPosts() = mine + team handles, not others', await call('x', `return A.findOwnPosts().map((a) => a.id).join()`) === 't101,t102,t104,t105');
check('X: readPost() id, url, date, text with emoji alt', await call('x', `const p = A.readPost(document.querySelector('#t105')); return [p.id, p.url, p.date.slice(0, 10), p.text].join('|')`) === '105|/demo_team/status/105|2026-03-03|This is huge 🚀🚀🔥');
check('X: formatRules key', await call('x', `return A.formatRules`) === 'x_format');

// ---------- LinkedIn: composer ----------
await go('/feed/', 1000);
await ev(`localStorage.setItem('st-store', JSON.stringify({ settings: { linkedinMe: 'demo_dev' } }))`);
await go('/feed/', 1000);
check('LinkedIn: matches() only www.linkedin.com', await call('linkedin', `return [A.matches('https://www.linkedin.com/feed/'), A.matches('https://x.com/home')].join()`) === 'true,false');
check('LinkedIn: platform picked for the page', await ev('window.SupertweetPlatform.id') === 'linkedin');
check('LinkedIn: findComposer() finds the late-mounted share editor', Boolean(await until(`window.SupertweetAdapters.linkedin.findComposer().length === 1`, 3000)));
check('LinkedIn: sendButtons() finds Post', await call('linkedin', `return A.sendButtons().map((b) => b.textContent.trim()).join()`) === 'Post');
check('LinkedIn: buttonFor/composersFor round-trip', await call('linkedin', `const c = A.findComposer()[0]; return A.composersFor(A.buttonFor(c))[0] === c`));
check('LinkedIn: formatRules key', await call('linkedin', `return A.formatRules`) === 'linkedin_format');
check('LinkedIn: share box does not send on Enter', await call('linkedin', `return A.enterSends(A.findComposer()[0])`) === false);

await go('/article/new/', 800);
await ev(`(() => { const t = document.querySelector('.article-editor-headline__textarea'); t.value = 'A thesis title'; })()`);
await ev(`document.querySelector('.article-editor-content [contenteditable]').textContent = 'Body text'`);
check('LinkedIn: readDraft() picks up the article title', await call('linkedin', `const d = A.readDraft(A.findComposer()[0]); return d.text + '|' + d.title`) === 'Body text|A thesis title');

// ---------- LinkedIn: comments ----------
await go('/comments/', 800);
check('LinkedIn: comment boxes are composers, send on Enter, and have a Comment button', await call('linkedin', `const c = A.findComposer()[0]; return [Boolean(c), A.enterSends(c), A.sendLabel(A.buttonFor(c))].join()`) === 'true,true,Comment');

// ---------- LinkedIn: activity ----------
await go('/in/demo_dev/recent-activity/all/', 800);
check('LinkedIn: isOwnActivityPage()', await call('linkedin', `return A.isOwnActivityPage('demo_dev') && !A.isOwnActivityPage('someone-else')`));
check('LinkedIn: findOwnPosts() skips reposts of others', await call('linkedin', `return A.findOwnPosts('demo_dev').map((p) => p.getAttribute('data-urn')).join()`) === 'urn:li:activity:1001,urn:li:activity:1003');
check('LinkedIn: readPost() urn, url, author, text', await call('linkedin', `const p = A.readPost(A.findOwnPosts('demo_dev')[0]); return [p.id, p.url, p.author, p.text.slice(0, 13)].join('|')`) === 'urn:li:activity:1001|https://www.linkedin.com/feed/update/urn:li:activity:1001/|demo_dev|Scale motion ');
check('LinkedIn: selectors fall back when the first one breaks', await call('linkedin', `
  const S = window.SupertweetLinkedInSelectors; const saved = S.activityPost.slice();
  S.activityPost[0] = '.this-class-was-renamed'; const n = A.findOwnPosts('demo_dev').length; S.activityPost.splice(0, S.activityPost.length, ...saved); return n`) === 2);

process.exit(close() ? 1 : 0);
