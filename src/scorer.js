// Supertweet scorer. Pure, synchronous, on-device. No network, no storage.
// Question: would a developer trust this person with a real problem?
(function (root) {
  'use strict';

  const GATE = 7;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Build a lexicon. A trailing "*" means prefix match ("deploy*" matches "deployed").
  function lexicon(terms) {
    return terms.map((term) => {
      const prefix = term.endsWith('*');
      const body = escapeRe(prefix ? term.slice(0, -1) : term).replace(/ +/g, '[\\s-]+');
      const tail = prefix ? '[\\p{L}\\p{N}_-]*' : '(?=$|[^\\p{L}\\p{N}_])';
      return { term, re: new RegExp('(?:^|[^\\p{L}\\p{N}_])(' + body + tail + ')', 'iu') };
    });
  }

  function hits(text, lex) {
    const out = [];
    for (const { term, re } of lex) {
      const m = re.exec(text);
      if (m) out.push(m[1] || term);
    }
    return out;
  }

  // ---------- Instant kills ----------

  const KILL = [
    {
      label: 'personal or veiled attack',
      lex: lexicon([
        'idiot*', 'moron*', 'stupid', 'dumb', 'dumbass', 'clown*', 'loser*', 'pathetic', 'imbecile*',
        'braindead', 'brain-dead', 'clueless', 'incompetent', 'grifter*', 'shill*', 'fraud*', 'fake guru*',
        'these people', 'some people', 'certain people', 'you people', 'imagine thinking', 'imagine being',
        'cope harder', 'seethe', 'skill issue', 'ratioed', "ratio'd", 'l take', 'touch grass', 'no one asked', 'nobody asked',
        'you know who you are', 'not naming names', 'not to name names', 'must be nice', 'funny how',
        'the same people who', 'unlike some', 'real engineers', 'actual engineers', 'ngmi', 'shut up',
        'get rekt', 'rekt', 'midwit*', 'npc*', 'cringe', 'delusional',
      ]),
    },
    {
      label: 'drugs, sex, or body talk',
      lex: lexicon([
        'weed', 'cannabis', 'marijuana', '420', 'stoned', 'high af', 'getting high', 'got high', 'so high', 'was high', 'baked', 'cocaine', 'molly',
        'mdma', 'lsd', 'acid trip', 'shrooms', 'psychedelic*', 'ketamine', 'adderall', 'xanax', 'opioid*',
        'fentanyl', 'meth', 'heroin', 'drunk', 'hungover', 'hangover', 'booze', 'beers', 'edibles', 'vape*',
        'microdos*', 'sex', 'sexy', 'sexual*', 'horny', 'porn*', 'onlyfans', 'nude*', 'naked', 'hookup*',
        'orgasm*', 'boob*', 'tits', 'booty', 'butt', 'dick', 'penis', 'thicc', 'bikini', 'my body',
        'body count', 'six pack', 'lose weight', 'weight loss', 'ozempic', 'steroid*', 'testosterone',
      ]),
    },
    {
      label: 'politics or divisive',
      lex: lexicon([
        'trump*', 'biden', 'kamala', 'harris', 'obama', 'maga', 'democrat*', 'republican*', 'gop', 'dems',
        'liberal*', 'conservative*', 'leftist*', 'right-wing', 'left-wing', 'woke', 'dei', 'election*',
        'vote', 'voting', 'ballot*', 'abortion', 'pro-life', 'pro-choice', 'immigra*', 'border wall',
        'gun control', 'second amendment', '2a', 'israel*', 'palestin*', 'gaza', 'hamas', 'zionis*',
        'ukraine', 'russia*', 'putin', 'zelensky', 'congress', 'senate', 'senator*', 'president',
        'politic*', 'anti-vax*', 'vaccine*', 'religio*', 'christian*', 'muslim*', 'atheis*',
        'gender war*', 'pronouns', 'socialis*', 'communis*', 'fascis*', 'nazi*', 'tariff*',
      ]),
    },
    {
      label: 'trite or what everyone is saying',
      lex: lexicon([
        'game changer', 'game-changer', 'gamechanger', 'let that sink in', 'read that again', 'hot take',
        'unpopular opinion', 'nobody is talking about', 'no one is talking about', 'this changes everything',
        'the future is now', 'the future is here', 'ai is the future', "ai won't replace you",
        'ai will replace', 'will replace developers', 'will replace programmers', "we're so back",
        "it's so over", 'wagmi', 'gm', 'gn', 'lfg', 'to the moon', 'rise and grind', 'hustle*', 'grindset',
        'consistency is key', 'just ship it', 'move fast and break things', 'learn to code', '10x engineer*',
        'a thread', "here's why", "here's the thing", 'fast-paced world', "in today's world", 'level up',
        'think outside the box', 'work smarter not harder', 'trust the process', 'embrace the journey',
        'agi is coming', 'is dead', 'are dead', 'is cooked', 'are cooked', 'cooked', 'this is the way',
        'a reminder that', 'normalize', 'stay humble', 'mindset is everything', 'never give up',
      ]),
    },
  ];

  const HYPE = lexicon([
    'insane', 'insanely', 'mind-blowing', 'mindblowing', 'mind blown', 'crazy', 'unreal', 'massive',
    'bullish', 'moon*', '1000x', '100x', 'omg', 'incredible', 'absolutely wild', 'wild', 'epic', 'legendary',
    'goated', 'banger', 'fire', 'huge', 'unbelievable', 'next level', 'next-level', 'amazing',
  ]);
  const HYPE_EMOJI = /[🚀🔥💯🤯😱🙌💥⚡️👀💎🤑😍🥳]/gu;

  // Weighted negativity; 2+ points is a kill.
  const NEG_STRONG = lexicon([
    'fuck*', 'shit*', 'bullshit', 'goddamn*', 'wtf', 'piss*', 'depressed', 'depressing', 'hopeless',
    'give up', 'giving up', 'nothing matters', 'pointless', 'doomed', 'kill myself', 'want to die',
    'i hate', 'hate this', 'hate it', 'hate when', 'fed up', 'sick of', 'tired of', 'rage*', 'furious',
    'disgust*', 'miserable', 'what a joke', 'joke of a', 'garbage', 'trash', 'worthless', 'rant',
  ]);
  const NEG_WEAK = lexicon([
    'hate', 'sucks', 'suck', 'worst', 'awful', 'terrible', 'horrible', 'annoying', 'annoyed', 'angry',
    'frustrat*', 'damn', 'crap*', 'ugh', 'meh', 'nobody cares', 'whatever',
    'overrated', 'overhyped', 'scam*', 'dying', 'burnout', 'burned out', 'exhausted', 'lonely', 'sad',
    'cynical', 'bleak', 'useless', 'disaster', 'nightmare', 'never works',
  ]);

  // ---------- Positive signals ----------

  const LEARNING = lexicon([
    'learned', 'learnt', 'til', 'today i learned', 'turns out', 'lesson*', 'realized', 'realised',
    'found that', 'figured out', 'discovered', 'the trick', 'the fix', 'what worked', "what didn't",
    'takeaway*', 'mistake*', 'i was wrong', 'changed my mind', 'mental model*', 'mindset', 'habit*',
    'insight', 'noticed', 'surprised', 'debugg*', 'root cause', 'the bug', 'the problem was',
  ]);
  const BUILDING = lexicon([
    'shipped', 'shipping', 'ship', 'built', 'building', 'launched', 'launching', 'released', 'release',
    'deployed', 'merged', 'refactor*', 'migrat*', 'rewrote', 'rewriting', 'prototyp*', 'working on',
    'added', 'wired up', 'open-sourced', 'open sourced', 'demo', 'mvp', 'side project', 'repo', 'commit*',
    'pull request', 'my project', 'our project', 'this week', 'today i', 'beta', 'v0', 'v1', 'v2',
  ]);
  const ACTIONABLE = lexicon([
    'how to', 'try', 'use', 'instead of', 'tip', 'pro tip', 'if you', 'run', 'set', 'configure', 'step*',
    "here's how", 'pattern', 'checklist', 'avoid', 'start with', 'swap', 'replace', 'add', 'pin',
  ]);
  const MECHANISM = lexicon([
    'because', 'so that', 'which means', 'via', 'since', 'so', 'which', 'means', 'caus*', 'result*',
    'instead of', 'the reason', 'trade-off*', 'tradeoff*', 'by using', 'by moving', 'by adding',
    'by caching', 'by batching', 'by splitting', 'works by', 'under the hood',
  ]);
  const CREDIBILITY = lexicon([
    'in production', 'prod', 'users', 'customers', 'benchmark*', 'measured', 'profil*', 'p99', 'p95',
    'latency', 'throughput', 'years', 'on call', 'on-call', 'incident', 'postmortem', 'post-mortem',
    'load test*', 'shipped', 'at scale', 'uptime',
  ]);
  const FRIENDLY = lexicon([
    'glad', 'excited', 'fun', 'enjoy*', 'love', 'thanks', 'thank you', 'grateful', 'happy', 'delight*',
    'nice', 'cool', 'neat', 'proud', "can't wait", 'looking forward', 'hope', 'kind', 'welcome',
  ]);
  const QUIRKY = lexicon([
    'weird*', 'oddly', 'odd', 'funny', 'accidentally', 'surprising*', 'unexpected*', 'turns out', 'plot twist',
  ]);
  const SLOPPY = lexicon([
    'lol', 'lmao', 'tbh', 'ngl', 'idk', 'kinda', 'sorta', 'gonna', 'wanna', 'stuff', 'u', 'ur', 'rn',
    'smth', 'bc', 'af', 'lowkey', 'highkey', 'literally', 'basically', 'like literally',
  ]);
  const FUTURISM = lexicon([
    'the future of', 'in the future', 'future', 'next decade', 'soon', 'will be', 'will change',
    'era of', 'paradigm*', 'revolution*', 'transform*', 'disrupt*', 'new age', 'world where',
    'imagine a world', 'one day', 'eventually', 'inevitabl*', 'singularity', 'post-agi', 'the next big',
  ]);
  const COINED = [
    /\bi(?:'m| am)? call(?:ing)? (?:it|this)\b/i,
    /\bintroducing\b/i,
    /["“][A-Z][\w-]+(?: [A-Z][\w-]+)?["”]/,
    /\b\w+-?(?:maxxing|pilled|core|nomics|verse)\b/i,
    /\bthe [a-z]+ (?:economy|era|thesis|movement|manifesto|doctrine)\b/i,
  ];

  // Technical vocabulary; doubles as a specificity signal.
  const TECH = lexicon([
    'api*', 'sdk', 'cli', 'llm*', 'gpt*', 'claude', 'opus', 'sonnet', 'haiku', 'gemini', 'openai', 'anthropic',
    'mcp', 'agent*', 'prompt*', 'embedding*', 'rag', 'eval*', 'fine-tun*', 'finetun*', 'token*', 'context window',
    'cursor', 'copilot', 'claude code', 'tool call*', 'tool use', 'subagent*', 'solana', 'anchor', 'spl',
    'validator*', 'rpc', 'lamport*', 'ethereum', 'solidity', 'evm', 'rust', 'cargo', 'typescript', 'javascript',
    'node', 'deno', 'bun', 'react', 'next.js', 'nextjs', 'svelte', 'vue', 'python', 'pandas', 'django',
    'fastapi', 'golang', 'swift', 'kotlin', 'ios', 'android', 'postgres*', 'sql*', 'sqlite', 'redis',
    'database*', 'index*', 'query', 'queries', 'schema*', 'kubernetes', 'k8s', 'docker', 'terraform', 'aws',
    'gcp', 'azure', 'lambda', 'ci', 'ci/cd', 'github', 'git', 'pr', 'test*', 'unit test*', 'flaky', 'cache*',
    'queue*', 'webhook*', 'cron', 'latency', 'ms', 'regex*', 'json', 'yaml', 'wasm', 'webassembly', 'gpu',
    'cuda', 'linux', 'bash', 'shell', 'vim', 'neovim', 'vscode', 'extension*', 'manifest v3', 'chrome',
    'brave', 'browser*', 'dom', 'css', 'html', 'oauth', 'auth', 'jwt', 'encryption', 'compiler', 'parser',
    'runtime', 'memory leak', 'profiler', 'benchmark*', 'deploy*', 'staging', 'monorepo', 'pipeline*',
    'etl', 'stripe', 'billing', 'infra*', 'genealog*', 'census', 'ancestry', 'gedcom', 'pdf', 'ocr',
    'transcri*', 'dedup*', 'structured data', 'metadata', 'recording*', 'firmware', 'arduino', 'raspberry pi', 'unity', 'godot', 'shader*',
  ]);
  const CODEY = [
    /`[^`]+`/, /\b[a-z]+[A-Z][a-zA-Z]+\b/, /\b[a-z]+_[a-z_]+\b/,
    /\b[\w-]+\.(?:js|ts|tsx|jsx|py|rs|go|md|json|sql|toml|ya?ml|sh|rb|swift|kt|css|html)\b/i,
    /(?:^|\s)--[a-z][\w-]*/, /\b\w+\(\)/, /\bv?\d+\.\d+(?:\.\d+)?\b/,
  ];
  const NUMBERISH = /\b\d+(?:[.,]\d+)?\s*(?:ms|s|sec|seconds|min|minutes|hours?|days?|weeks?|x|%|kb|mb|gb|tb|k|lines?|loc|users?|requests?|rps|qps|tokens?|files?|tests?|bugs?|prs?|commits?|\$)?/i;

  // ---------- Audiences ----------

  const AUDIENCES = [
    ['agent-tooling developers', ['agent*', 'subagent*', 'mcp', 'tool call*', 'tool use', 'claude code', 'cursor', 'copilot', 'orchestrat*', 'workflow*']],
    ['applied LLM engineers', ['llm*', 'prompt*', 'embedding*', 'rag', 'eval*', 'fine-tun*', 'finetun*', 'context window', 'token*', 'claude', 'gpt*', 'openai', 'anthropic', 'gemini', 'model*']],
    ['Solana protocol people', ['solana', 'anchor', 'spl', 'validator*', 'lamport*', 'rpc', 'sealevel', 'jito', 'phantom']],
    ['EVM smart-contract devs', ['ethereum', 'solidity', 'evm', 'foundry', 'hardhat', 'erc-*', 'l2', 'rollup*']],
    ['founders shipping boring infrastructure', ['founder*', 'startup*', 'customers', 'revenue', 'mrr', 'arr', 'billing', 'stripe', 'invoic*', 'compliance', 'boring', 'infra*', 'backoffice', 'back office']],
    ['family-history builders', ['genealog*', 'family history', 'family tree', 'ancestry', 'ancestor*', 'census', 'gedcom', 'obituar*', 'memoir*', 'oral history', 'grandparent*', 'grandfather', 'grandmother', 'archive*']],
    ['Rust systems programmers', ['rust', 'cargo', 'borrow checker', 'tokio', 'unsafe', 'crate*']],
    ['TypeScript and React devs', ['typescript', 'javascript', 'react', 'next.js', 'nextjs', 'svelte', 'vue', 'node', 'deno', 'bun', 'npm', 'vite']],
    ['Python developers', ['python', 'pandas', 'django', 'fastapi', 'pip', 'uv', 'pytest', 'jupyter']],
    ['database and Postgres people', ['postgres*', 'sql*', 'sqlite', 'database*', 'index*', 'query', 'queries', 'schema*', 'migration*', 'redis']],
    ['DevOps and platform engineers', ['kubernetes', 'k8s', 'docker', 'terraform', 'aws', 'gcp', 'azure', 'ci/cd', 'ci', 'deploy*', 'staging', 'on-call', 'on call', 'incident*', 'uptime']],
    ['browser-extension builders', ['extension*', 'manifest v3', 'chrome', 'brave', 'content script*', 'browser*']],
    ['mobile developers', ['ios', 'android', 'swift', 'swiftui', 'kotlin', 'react native', 'flutter', 'xcode']],
    ['engineers who care about testing', ['test*', 'unit test*', 'flaky', 'coverage', 'tdd', 'regression*', 'pytest', 'jest']],
    ['performance tuners', ['latency', 'p99', 'p95', 'throughput', 'benchmark*', 'profil*', 'cache*', 'memory leak', 'faster', 'ms']],
    ['security-minded engineers', ['security', 'auth', 'oauth', 'jwt', 'encryption', 'vulnerab*', 'cve*', 'secrets', 'credential*', 'privacy', 'on-device', 'local-first']],
    ['open-source maintainers', ['open source', 'open-source', 'open-sourced', 'oss', 'maintainer*', 'github', 'pull request', 'contributor*', 'license']],
    ['indie hackers and solo builders', ['side project', 'solo', 'indie', 'weekend', 'bootstrap*', 'my project', 'launched', 'mvp']],
    ['data engineers', ['etl', 'pipeline*', 'warehouse', 'dbt', 'spark', 'analytics', 'dataset*', 'parquet']],
    ['document and publishing toolmakers', ['pdf', 'ocr', 'transcri*', 'book*', 'publishing', 'typeset*', 'docx', 'markdown']],
    ['legal-tech builders', ['legal', 'court', 'filing*', 'discovery', 'contract*', 'paralegal']],
    ['hardware hackers', ['firmware', 'arduino', 'raspberry pi', 'esp32', 'pcb', 'soldering', 'microcontroller*']],
    ['game developers', ['unity', 'godot', 'unreal', 'shader*', 'game dev', 'gamedev']],
    ['developers working on their craft', ['learned', 'lesson*', 'mindset', 'habit*', 'mental model*', 'mistake*', 'growth', 'mentor*', 'career', 'junior', 'senior']],
  ].map(([label, terms]) => ({ label, lex: lexicon(terms) }));

  function audiences(text, max = 5) {
    const ranked = [];
    AUDIENCES.forEach(({ label, lex }, i) => {
      const n = hits(text, lex).length;
      if (n) ranked.push({ label, n, i });
    });
    ranked.sort((a, b) => b.n - a.n || a.i - b.i);
    return ranked.slice(0, max).map((r) => r.label);
  }

  // ---------- Repetition ----------

  const STOP = new Set(('a an the and or but if then so of to in on at for with by from as is are was were be been ' +
    'it its this that these those i im me my we our you your they them their he she his her not no yes do does did ' +
    'have has had just very really more most can will would should could about into than also there here what when ' +
    'how why who which all any some one get got make made out up over').split(' '));

  function contentTokens(text) {
    return new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])
        .map((w) => w.replace(/'s$/, '').replace(/(?:ing|ed|es|s|e)$/, ''))
        .filter((w) => w.length > 2 && !STOP.has(w))
    );
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
  }

  function findRepeat(text, history) {
    const mine = contentTokens(text);
    if (mine.size >= 5) {
      for (const prev of history || []) {
        if (!prev || prev === text) continue;
        // History entries may be pre-tokenized Sets (bulk grading) or raw strings.
        if (jaccard(mine, prev instanceof Set ? prev : contentTokens(prev)) >= 0.55) return 'same point as an earlier post';
      }
    }
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(contentTokens).filter((s) => s.size >= 4);
    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        if (jaccard(sentences[i], sentences[j]) >= 0.6) return 'makes the same point twice';
      }
    }
    return null;
  }

  // ---------- Score ----------

  function bucketFor(score, killed) {
    if (killed) return 'kill';
    if (score >= 8) return 'sweet';
    if (score >= 4) return 'middle';
    return 'below';
  }

  function result(score, reason, killed, text) {
    const s = Math.max(0, Math.min(10, Math.round(score)));
    const bucket = bucketFor(s, killed);
    let aud = killed || s < 4 ? [] : audiences(text);
    if (!killed && s >= 4 && !aud.length) aud = ['general software developers'];
    return { score: s, bucket, reason, audiences: aud, passes: !killed && s >= GATE };
  }

  function score(rawText, opts = {}) {
    const text = String(rawText || '').replace(/​/g, '').trim();
    const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
    if (!words.length) return result(0, 'Draft is empty.', false, text);

    // Kills
    for (const { label, lex } of KILL) {
      const h = hits(text, lex);
      if (h.length) return result(0, `Kill: ${label} (“${h[0]}”).`, true, text);
    }
    const negStrong = hits(text, NEG_STRONG);
    const negWeak = hits(text, NEG_WEAK);
    if (negStrong.length * 2 + negWeak.length >= 2) {
      return result(0, `Kill: cynical or negative tone (“${(negStrong[0] || negWeak[0])}”).`, true, text);
    }
    const repeat = findRepeat(text, opts.history);
    if (repeat) return result(0, `Kill: repeats a point, ${repeat}.`, true, text);

    const tech = hits(text, TECH);
    const codey = CODEY.filter((re) => re.test(text)).length;
    const hasNumber = NUMBERISH.test(text) && /\d/.test(text);
    const spec = tech.length + codey + (hasNumber ? 1 : 0);
    const contentWords = contentTokens(text).size;

    const hype = hits(text, HYPE).length;
    const hypeEmoji = (text.match(HYPE_EMOJI) || []).length;
    const exclaims = (text.match(/!/g) || []).length;
    const letters = text.replace(/[^\p{L}]/gu, '');
    const capsRatio = letters.length ? letters.replace(/[^\p{Lu}]/gu, '').length / letters.length : 0;
    if (
      hype + hypeEmoji >= 3 ||
      (hype + hypeEmoji >= 2 && spec === 0) ||
      exclaims >= 3 ||
      (capsRatio > 0.6 && words.length >= 4) ||
      (contentWords < 4 && (hype >= 1 || exclaims >= 2 || hypeEmoji >= 2))
    ) {
      return result(0, 'Kill: zero-value hype or pure emotion.', true, text);
    }

    const learning = hits(text, LEARNING).length > 0;
    const building = hits(text, BUILDING).length > 0;
    const actionable = hits(text, ACTIONABLE).length > 0;
    const mechanism = hits(text, MECHANISM).length > 0;
    const credibility = hits(text, CREDIBILITY).length > 0;
    const friendly = hits(text, FRIENDLY).length > 0;
    const quirky = hits(text, QUIRKY).length > 0;
    const personal = /\b(?:i|i'm|i’m|i've|i’ve|we|we're|we’re|our|my|me)\b/i.test(text);
    const sloppy = hits(text, SLOPPY).length + (/\.\.\.|…/.test(text) ? 1 : 0);
    const futurism = hits(text, FUTURISM).length;
    const coined = COINED.some((re) => re.test(text));

    const concrete = spec >= 1 || mechanism;
    const substance = learning || building || actionable || credibility;

    let s = 3;
    s += Math.min(2.5, spec * 0.6);
    if (learning) s += 1.5;
    if (building) s += 1.5;
    if (actionable) s += 1;
    if (mechanism) s += 1;
    if (credibility) s += 1;
    if (personal) s += 0.5;
    if (friendly) s += 0.5;
    if (quirky && concrete) s += 0.5;
    s -= sloppy * 0.75;
    s -= futurism * 1.5;

    // Below 4: too short, futurism, coined name, or slogan.
    if (words.length < 6) return result(Math.min(s, 3), 'Too short to carry an insight.', false, text);
    if (futurism && !(spec >= 2 && mechanism)) {
      return result(Math.min(s, 3), 'Vague futurism. Name the mechanism or what you actually saw.', false, text);
    }
    if (coined && !mechanism) {
      return result(Math.min(s, 3), 'Coined name with no mechanism. Say how it works.', false, text);
    }
    if (words.length <= 10 && !concrete && !learning && !building) {
      return result(Math.min(s, 3), 'Reads like a slogan. Add a specific result or how-to.', false, text);
    }

    // Middle: true but generic, or sloppy tone.
    s = Math.max(s, 4);
    if (!concrete) return result(Math.min(s, 6), 'True but generic. Add a number, tool, or concrete result.', false, text);
    if (!substance) return result(Math.min(s, 6), 'What did you build, learn, or measure? Say it.', false, text);
    if (sloppy >= 2) return result(Math.min(s, 7), 'The insight is there but the tone is sloppy. Tighten it.', false, text);

    const r = Math.round(s);
    if (r >= 8) {
      const what = building ? 'build update' : learning ? 'learning' : actionable ? 'how-to' : 'experience';
      const why = spec >= 2 && mechanism ? 'concrete detail and a mechanism' : spec >= 2 ? 'concrete detail' : 'a clear mechanism';
      return result(s, `Specific ${what} with ${why}.`, false, text);
    }
    if (!mechanism) return result(s, 'Close. Say why or how it works.', false, text);
    if (spec < 2) return result(s, 'Close. Add a number, tool name, or result.', false, text);
    return result(s, 'Solid. Sharpen one detail to make it land.', false, text);
  }

  const api = { score, audiences, tokens: contentTokens, GATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetScorer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
