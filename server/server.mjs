// Supertweet grading backend. Local only (127.0.0.1). Holds the Anthropic key; the extension never sees it.
// Run: ANTHROPIC_API_KEY=... npm start
import http from 'node:http';
import { ObjectivesSchema, validateRequest, loadAudienceSets, pipeline, cleanExtras, loadObjectives, apiError, MODEL_ID, EFFORT_LEVEL } from './grader.mjs';
import rules from '../config/x-algorithm-rules.json' with { type: 'json' };

export { ObjectivesSchema, validateRequest, loadAudienceSets };

const PORT = Number(process.env.SUPERTWEET_PORT || 8787);

// Web pages can POST to localhost too; only the extension (or a local non-browser client) may spend the key.
export function originAllowed(origin) {
  return !origin || origin.startsWith('chrome-extension://');
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}


export function createServer() {
  return http.createServer(async (req, res) => {
    if (!originAllowed(req.headers.origin)) return send(res, 403, { error: 'origin not allowed' });
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, model: MODEL_ID, effort: EFFORT_LEVEL, audience_sets: loadAudienceSets().map((x) => x.audience_set), has_key: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
    }
    if (req.method === 'GET' && req.url === '/audience-sets') return send(res, 200, { sets: loadAudienceSets() });
    if (req.method !== 'POST' || !['/grade', '/tune', '/analyze', '/critique'].includes(req.url)) return send(res, 404, { error: 'not found' });

    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 2_000_000) return send(res, 413, { error: 'body too large' });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid JSON' }); }
    if (typeof body.post_text !== 'string' || !body.post_text.trim()) return send(res, 400, { error: 'post_text is required' });
    const doc = body.objectives && Array.isArray(body.objectives.objectives) ? body.objectives : loadObjectives();
    try {
      // The pipeline caches by request, so the same draft always gets the same grade.
      if (req.url === '/tune') return send(res, 200, await pipeline.tune({ ...body, platform: 'x', objectives: doc, ...cleanExtras(body), rules }));
      if (req.url === '/analyze') return send(res, 200, await pipeline.analyzeForX({ ...body, objectives: doc }));
      if (req.url === '/critique') return send(res, 200, await pipeline.critique({ ...body, objectives: doc, ...cleanExtras(body) }));
      const invalid = validateRequest(body);
      if (invalid) return send(res, 400, { error: invalid });
      send(res, 200, await pipeline.gradeDraft({ ...body, objectives: doc, ...cleanExtras(body) }));
    } catch (err) {
      const { status, message } = apiError(err);
      console.error('[grade]', message);
      send(res, status, { error: message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`Supertweet grader on http://127.0.0.1:${PORT} (model ${MODEL_ID}, effort ${EFFORT_LEVEL})`);
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.warn('No ANTHROPIC_API_KEY set: grading will fail closed.');
  });
}
