# Supertweet guide

Everything you need to build, install, run and use the Supertweet extension.

- [1. What it does](#1-what-it-does)
- [2. Requirements](#2-requirements)
- [3. Build](#3-build)
- [4. Install in Chrome or Brave](#4-install-in-chrome-or-brave)
- [5. Connect a grader](#5-connect-a-grader)
- [6. Using it](#6-using-it)
- [7. Settings](#7-settings)
- [8. Privacy and safety](#8-privacy-and-safety)
- [9. Development](#9-development)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Updating and uninstalling](#11-updating-and-uninstalling)

---

## 1. What it does

On **x.com** and **linkedin.com**, Supertweet adds a logo bubble next to your composer. Click it to open the score panel. The site's own Post / Reply / Comment button is hidden; the panel's **Post** button is the only way to send, and it stays locked until the exact draft you're about to send passes.

**The score: the Developer Trust filter.** "Would a developer trust you with a real problem?" 0-10.

| Bucket | Score | What lands here |
| --- | --- | --- |
| Kill | 0 | Personal or veiled attacks, drugs or sex, politics or culture war, cynical or depressive looping, repeating the same point, emotion-only hype |
| Low | below 4 | Zero-value hype, vague futurism, a coined name with no test |
| Middle | 4-7 | True but trite or sloppy |
| Sweet | 8-10 | Specific learnings from building, building updates, tools and skills a developer can use, experience that shows skill |

Post unlocks at **8.0 or above** with no open privacy questions.

## 2. Requirements

- **Google Chrome, Brave, or Edge** (any Chromium browser that supports Manifest V3).
- **Node.js 22 or newer** and npm, to build, run the local grader, or run the tests.
- **A grader**, one of:
  - an **Anthropic API key** for the local grader server (recommended), or
  - the hosted Supertweet backend (invite-only: an allowlisted X account).
- `zip` (preinstalled on macOS and most Linux) for `npm run package`.

## 3. Build

```bash
git clone https://github.com/Verafyai/supertweet-extension.git
cd supertweet-extension
npm install
npm run package
```

`npm run package` writes:

- `dist/pkg/`: the unpacked extension, ready for **Load unpacked**.
- `dist/supertweet.zip`: the same files zipped, for sharing or the Chrome Web Store.

The build never includes the server, the tests, or a private `config/audience-profiles.json` (it refuses to build if that file would end up inside).

There's no compile step: the extension is plain JavaScript, so you can also load the repo folder itself while developing.

## 4. Install in Chrome or Brave

1. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `dist/pkg` (or the repo folder).
4. Pin Supertweet from the puzzle-piece menu so its popup is one click away.

To install from a release instead: download `supertweet.zip` from the repo's **Releases** page, unzip it, and load the unzipped folder the same way.

After any update to the files, click the **reload** arrow on the extension's card, then refresh your X and LinkedIn tabs.

## 5. Connect a grader

The extension never calls a model itself. It sends drafts (with your private terms and contact info already masked) to a grader you choose.

### Option A: your own local grader (recommended)

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # your key; never commit it
npm run server                           # http://127.0.0.1:8787
```

Then in the extension popup → **Advanced** → **Grader**, enter `http://127.0.0.1:8787`. The popup shows "Local grader running" with the model name.

Server options (environment variables):

| Variable | Default | What it does |
| --- | --- | --- |
| `SUPERTWEET_PORT` | `8787` | Port to listen on (always 127.0.0.1) |
| `SUPERTWEET_MODEL` | `claude-opus-5-5` | Model used for every grade |
| `SUPERTWEET_EFFORT` | `low` | Effort level |
| `SUPERTWEET_FAST` | on | `0` turns off fast mode |

The local server only accepts requests from the extension (a `chrome-extension://` origin), never from web pages.

### Option B: the hosted grader (invite-only)

The extension's default grader is the Supertweet web app. Only allowlisted X accounts can use it.

1. Open <https://supertweet-plum.vercel.app> and click **Connect X**.
2. Leave that tab open for a second. The extension picks up a token from the page and links itself; the popup turns green and shows your handle.

**Cost.** Grading only runs when you press Grade. One grade is three model calls (the score is the median of three) plus one comparison call per suggested edit. Tune for X re-grades each edit it keeps; the Details critique is one call when you open it. Grades are cached by draft, so the same text is never graded twice.

## 6. Using it

### Writing a post

1. Start a post on X or LinkedIn. The Supertweet bubble appears; click it to open the panel. The panel docks beside the composer (on narrow windows it shifts the page over) so your draft is never covered.
2. Privacy checks run on every keystroke, on your device.
3. Press **Grade** (or ⌘/Ctrl+Enter in the composer). The panel shows:
   - **Serving:** which of your objectives the post is for (context for the grader; it never locks anything).
   - **The score** and a pill: "Locked · needs 8+" or "Ready".
   - **The bucket bar** (Kill | Low | Middle | Sweet) with a marker at the score, and one line on why.
   - **Why this score ▸**: the critique (see below).
   - **Get to 8**: at most two steps, each worth 1.0+ points:
     - *Attach screenshot* opens the site's own image picker.
     - *A question* only you can answer: type it in and Apply, or **Skip, I don't have this** (never changes the score).
     - *A one-line edit* with Apply.
     - Numbers Supertweet already knows (drafts scored, your average) are filled in for you, never asked for.
     - **👎 Bad advice** removes a step; your last 10 rejections and overrides teach the grader what not to suggest.
     - If nothing is worth suggesting: "Ready as written" and why.
   - The safety line, or privacy questions and kills expanded in place.
   - **X algorithm N (advisory)** with **Tune for X** and **Details** (X only; never gates Post).
4. Edit the draft and press **Re-grade**. Every change the panel makes can be undone (**Undo last change**).
5. When it passes, **Post to X** / **Post to LinkedIn** clicks the site's own button for you and confirms the post went out. If it didn't, the site's button comes back.

### Kills and "Post anyway"

A kill shows as a red block naming the category and quoting the words that triggered it. **Post anyway, with a reason** (8+ characters, logged) gets past a kill, a low score, the lawyer check, or a grader outage. Nothing gets past contact info, street addresses, your private terms, engagement bait, or unfilled placeholders like `[YOUR NUMBER]`.

If three grades disagree by more than 1.0, you'll see **Unstable score** and the score won't lock you out.

### Tune for X

One pass over the whole draft: cleanup (bait, hype, extra hashtags and emoji, shouty caps), then one model edit aimed at what X's ranker rewards most (something worth sending, an ending worth replying to, a quotable opener). Before anything changes you see both scores ("X algorithm 3.6 → 7.2, objective 6.0 → 6.0") and a line-by-line diff. **Accept** applies it; **Undo** restores your original exactly. Edits that would lower your trust score, invent a number, or pass 280 characters are dropped. If it can't add at least 1.0, it says "Already in good shape for X".

### Details (X algorithm)

At most three fixes for this draft, ranked by the weight behind them, each quoting your words or naming exactly what's missing, with a rewritten line and a **Fix** button. Passing checks collapse to "N checks pass." Timing is specific: "Your last post was 40 minutes ago. Posting after 3:10 PM avoids the author diversity penalty." with **Queue for 3:10 PM** (queued drafts are in the popup).

### Past posts

On X, every post of yours on screen gets a badge: score, bucket, one line on why. **Details ▸** expands:

1. **What works**, quoting your phrase.
2. **What costs points**, quoting the span, with why (futurism, unverified claim, abstract, sloppy).
3. **Pushback**: the strongest reply a skeptical senior developer would post.
4. **How to get to 8**: one direction and a rewrite under 280 characters, using only facts from the post or your Supertweet data. If it needs something you haven't done or said, it says so instead.
5. **Breakdown**: shows building · specific · useful to a developer · voice (0-10 each; they explain the score, they don't replace it).
6. **Reach versus trust**: views, likes, replies and reposts next to the score, and one line when a low-trust post outreached a high-trust one.

On LinkedIn, open your own `/in/<you>/recent-activity/` page (set your LinkedIn slug in the popup → Advanced). It gets the same badges plus an **Export scores (CSV)** button.

### History and deleting (X)

On your profile's **Posts & replies** tab, the **Supertweet history** button scans and caches your posts and lists them worst first, with score, bucket, why and link. Deleting is never automatic and never in bulk: each post has its own **Delete…** button, which opens that post, asks you to confirm for that post, uses X's own delete menu, and logs the deletion.

## 7. Settings

- **Popup → Advanced:** your LinkedIn slug, **your other X handles** (e.g. a team or company account; their posts get badges and appear in history too; the account you're logged into X with is always included), and the grader URL (`http://127.0.0.1:<port>` or the hosted one).
- **Options page** (popup → "Objectives and private terms"):
  - **Objectives:** edit `objectives.json` as validated JSON. They tell the grader who's reading; changes apply to open tabs right away. The bundled file is an example: replace it with your own. Its `projects` list names projects you've built, which the critique's rewrite may mention.
  - **Private terms:** names, projects, anything that must never be posted or leave your device. They block Post and are masked before any text is sent.
  - **X algorithm:** "Check for changes now" re-syncs X's published ranking weights (it also runs weekly). You're only alerted when a weight or distribution setting that affects posts changes ("Replies now weigh 6 (was 5).").

## 8. Privacy and safety

- The extension never posts, likes, follows or deletes on its own. Every send and every delete starts with your click.
- Private terms and contact info are masked to `[PRIVATE]` before a draft leaves the browser; private terms are stored only in this browser.
- No credentials are stored. The hosted grader uses a signed token from your X sign-in; the local grader needs no token.
- Content scripts make no network calls; only the background worker talks to your chosen grader and, weekly, to GitHub's raw files for X's published algorithm.

## 9. Development

```text
src/content.js       send gate, docking, which composer the panel follows
src/audience.js      grading, panel state, Tune, Details, critique wiring
src/panel.js         the score panel (ported from docs/spec/panel-ref/panel-reference.html)
src/steps.js         edit rules: one line at a time, line breaks kept, no placeholders, app stats
src/critique.js      the Details critique and reach versus trust
src/x-linter.js      X algorithm checks, fit score, cleanup, sync classification
src/tmi.js           on-device privacy checks
src/objectives.js    the trust result parser, buckets and the send gate
server/pipeline.mjs  three grades + median, steps, pairwise checks, Tune, X review, critique
server/grader.mjs    model calls (structured output), request notes
server/server.mjs    the local grader server
```

Load the repo folder as an unpacked extension while you work; reload it after changes.

### Tests

```bash
npm test             # unit + server + end-to-end (needs Google Chrome at the default path)
npm run test:unit    # unit tests only
node test/acceptance.e2e.mjs   # one end-to-end suite
```

The end-to-end suites run headless Chrome against fixture pages that mimic X and LinkedIn, with the real grading pipeline on a mock model, so they need no API key. `SHOT_DIR=/some/folder node test/acceptance.e2e.mjs` saves screenshots.

LinkedIn's markup changes often. If the bubble doesn't appear there, update the selectors in `src/adapters/linkedin.selectors.js` (each is a list of fallbacks).

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| No bubble on X or LinkedIn | Reload the extension, then refresh the tab. On LinkedIn, open the share box or a comment box first. |
| Popup says "Not linked" | Open the hosted site and sign in with X, or set a local grader URL. |
| "Grader offline" in the panel | Hosted: sign in again. Local: is `npm run server` running, with `ANTHROPIC_API_KEY` set? Try `curl http://127.0.0.1:8787/health`. |
| "Can't find X's Post button" | X changed its markup. Supertweet stops hiding anything so you can post normally; report it so the adapter can be updated. |
| Post didn't go through | The site's own button is back; post with it, or press Grade again. |
| A draft keeps the same score | Grades are cached by exact text. Change the draft (or the Serving objective) and Re-grade. |
| Fonts look different | Reload the extension; the panel's font ships inside `fonts/`. |

## 11. Updating and uninstalling

- **Update:** `git pull && npm run package`, then reload the extension and refresh your tabs.
- **Uninstall:** remove it from the extensions page. That deletes its local storage (cached grades, private terms, queue, logs) too.
