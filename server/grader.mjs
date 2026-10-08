// Shared grading core: the local server (server.mjs) and the Vercel functions (api/) both use it.
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { createPipeline } from './pipeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.SUPERTWEET_MODEL || 'claude-opus-5-5';
// Live grading runs on every pause in typing: low effort keeps it quick.
const EFFORT = process.env.SUPERTWEET_EFFORT || 'low';
const CONFIG = path.join(here, '..', 'config');
const PROMPT = readFileSync(path.join(CONFIG, 'grader-prompt.md'), 'utf8');
// Private, untracked. The extension never bundles it; only this local server reads it.
const PROFILES_PATH = process.env.SUPERTWEET_PROFILES || path.join(CONFIG, 'audience-profiles.json');

// On Vercel the private file can't ship in the repo: put its JSON in AUDIENCE_PROFILES_JSON instead.
export function loadAudienceSets(file = PROFILES_PATH) {
  const fromEnv = file === PROFILES_PATH ? process.env.AUDIENCE_PROFILES_JSON : null;
  if (!fromEnv && !existsSync(file)) return [];
  try {
    const doc = JSON.parse(fromEnv || readFileSync(file, 'utf8'));
    // Either one set ({ audience_set, profiles, ... }) or { audience_sets: [...] }.
    return Array.isArray(doc.audience_sets) ? doc.audience_sets : doc.audience_set ? [doc] : [];
  } catch (e) { console.error(`[profiles] ${file}: ${e.message}`); return []; }
}

const OBJECTIVES_PATH = path.join(CONFIG, 'objectives.json');
export const loadObjectives = () => JSON.parse(readFileSync(OBJECTIVES_PATH, 'utf8'));

// Notes for the request shapes Supertweet sends, kept separate so the prompt file stays as written.
const ADDENDUM = `
---

# Request notes (Supertweet)
- Score with the Developer Trust filter for every "score" request. Do not run audience-set, persona, panel or algorithm scoring.
- \`objectives\` in the context is objectives.json: context for who reads this author. \`objective_id\` in the request, when present, is the objective the author picked; echo it. It never changes the trust score.
- \`deterministic_checks\` were computed in code (words, characters, em-dashes, hashtags, links). Trust them over your own counting.
- \`attachments\` lists media attached to the post ("image", "video"). An attached screenshot or clip of the thing the post describes shows the work, which is what a developer trusts.
- Spans masked as [PRIVATE] were redacted on purpose; don't guess at them and never quote them.
- \`post_text\` keeps the author's line breaks. Every \`line_before\` must be one whole line copied exactly from post_text.
- Steps ("steps" in the output), at most 2, ranked by points. Fewer, better steps: never suggest a step worth under 1.0 point. If nothing clears that bar, return []: the draft is "ready as written" and that's a good answer. Don't invent tweaks.
  - Prefer cuts to additions. A step may only make the post longer if it adds proof (set "adds_proof": true).
  - Protect the voice. Never flatten the hook, the humor or the self-deprecation into neutral phrasing. If an edit would change the tone, don't suggest it.
  - Edits must make the post better to read for a smart reader in the objective's audience, not just tick a rubric box. No nitpicks, no drier rewrites.
  - "attach_proof": "action_label" is the button text ("Attach screenshot", "Attach clip", "Add the link"); "proof_kind" is screenshot, clip or link. line_before/line_after null.
  - "ask_fact": optional, and only for a fact that only the author knows and that would clearly help (the author can skip it). Never ask for numbers in \`app_stats\` (drafts scored, average score, most-failed checks, posts through the gate): use the value given there in a line_edit instead (set "adds_proof": true). A claim with no number isn't missing proof if an attached screenshot or a link already backs it. "question" labels an input for a fact only the author knows; "example" is its placeholder ("e.g. 31"); "line_before" is the line it improves; "line_after" is that same line with {answer} where the author's answer goes. Nothing else in line_after is a placeholder.
  - "line_edit": "line_before" and "line_after" are one line each. Change the smallest span; keep most of the line's own words and the author's voice. A self-deprecating punchline stays and gets more concrete. Only sharpen the first line (the hook), never replace it.
  - On X, keep the whole post within 280 characters after the step (\`deterministic_checks\` has the count). If the draft is already over, prefer steps that shorten it.
  - Never put [brackets] or invented facts (numbers, names, results, links) in line_after. Never merge or split lines.
  - "points" is your estimate of what the step adds to the trust score. Steps only move a post into the sweet zone (8.0 or more is the gate); return [] when it's already there or it's a kill. When no step qualifies, put one line in "no_steps_reason".
- The output has "steps" in place of "edits".
- \`app_stats\` are the author's real Supertweet numbers, computed by the app. They're true; use them instead of asking.
- \`avoid\` lists suggestions the author rejected ("rejected_step") and gate overrides with their reasons ("override"). Treat them as examples of what not to suggest: don't repeat them or anything like them.
- \`mode: "compare"\`: two versions of the same post, "a" and "b". Which would a smart reader in \`audience\` (the objective's audience) rather read? "winner" is "a", "b" or "tie". "clearly_better" is true only if the winner is clearly better, not marginally. "tone_changed" is true if one version flattens the hook, the humor or the self-deprecation into neutral phrasing or otherwise changes the author's tone. One-sentence "reason".
- \`mode: "critique"\`: a Developer Trust critique of post_text, direct but not harsh, no generic advice. Every "quote" must be copied exactly from post_text.
  - "works": 1-2 things that earn trust, each with the exact phrase quoted.
  - "costs": up to 3 spans that cost points, each quoted exactly, with "why" in plain words and "kind" (futurism, unverified, abstract, sloppy, other).
  - "pushback": the strongest reply a skeptical senior developer would actually post, one or two sentences, written as that reply. A real counterargument, never "add more detail".
  - "direction": one concrete direction to reach 8.
  - "rewrite": the post rewritten toward 8, under 280 characters, keeping the author's line breaks and voice. Use only facts in post_text, in \`known_facts.app_stats\`, or the projects in \`known_facts.projects\`. Never write an action as done if the post doesn't say it happened (e.g. running a test). If getting to 8 needs a fact or an action the author hasn't given, say so plainly in "needs" and leave it out of the rewrite (or set "rewrite" to null).
  - "breakdown": four 0-10 sub-ratings that explain the trust score (they don't replace it): shows_building, specific, useful (to a developer), voice.
- \`mode: "algo"\`: X ranking review of post_text against \`checks\` (the failing algorithm checks, with the weights behind them) and the judgment checks.
  - "verdicts": your judgment, pass/warn/fail, for shareable (worth sending to someone: copy-link shares weigh 20), reply (an ending people want to reply to: 5, +15 from mutuals), quote (a quotable claim: 5), follow (a reason to follow the author), on_topic (on-topic for the objective; building a tool counts). Judge the meaning, not keywords.
  - "checks": for each failing or warning check you can fix specifically: "span" (the exact text it's about, copied from post_text) or "missing" (exactly what's missing from THIS draft), and "fix_line_before"/"fix_line_after" (one whole line copied from post_text, and that line rewritten). Generic advice ("add the concrete artifact", "say what you built") is not allowed; if you can't write a specific rewritten line, leave the check out.
  - "tune_edits": one pass over the whole draft aimed at the highest-weight signals (something worth sending, an ending worth replying to, a quotable opener, not link-only). Smallest edits, one line each, line breaks kept, hook and voice kept, no invented facts or numbers, 280 characters max on X. Don't lower how well it serves the objective.
  - "verdicts_after": your verdicts for the post with all tune_edits applied.
- \`verify: true\` means post_text (with attachments) is the draft as it would be after a proposed step: score it exactly as you would any draft.
`;

const Verdict = z.enum(['pass', 'warn', 'fail']);
const Verdicts = z.object({ shareable: Verdict, reply: Verdict, quote: Verdict, follow: Verdict, on_topic: Verdict });
export const CompareSchema = z.object({ winner: z.enum(['a', 'b', 'tie']), clearly_better: z.boolean(), tone_changed: z.boolean(), reason: z.string() });
export const CritiqueSchema = z.object({
  works: z.array(z.object({ point: z.string(), quote: z.string() })),
  costs: z.array(z.object({ quote: z.string(), why: z.string(), kind: z.enum(['futurism', 'unverified', 'abstract', 'sloppy', 'other']) })),
  pushback: z.string(),
  direction: z.string(),
  rewrite: z.string().nullable(),
  needs: z.array(z.string()),
  breakdown: z.object({ shows_building: z.number(), specific: z.number(), useful: z.number(), voice: z.number() }),
});
export const AlgoSchema = z.object({
  verdicts: Verdicts,
  checks: z.array(z.object({ id: z.string(), status: Verdict, span: z.string().nullable(), missing: z.string().nullable(), fix_line_before: z.string().nullable(), fix_line_after: z.string().nullable() })),
  tune_edits: z.array(z.object({ line_before: z.string(), line_after: z.string(), signal: z.string() })),
  verdicts_after: Verdicts,
});
const Tmi = z.object({ category: z.enum(['contact', 'address', 'legal', 'confidential', 'job', 'money', 'housing', 'health', 'family', 'heat', 'other']), span: z.string(), question: z.string() });
const Step = z.object({
  type: z.enum(['attach_proof', 'ask_fact', 'line_edit']),
  title: z.string(),
  why: z.string(),
  points: z.number(),
  action_label: z.string().nullable(),
  proof_kind: z.enum(['screenshot', 'clip', 'link']).nullable(),
  question: z.string().nullable(),
  example: z.string().nullable(),
  line_before: z.string().nullable(),
  line_after: z.string().nullable(),
  adds_proof: z.boolean(),
});
export const KILL_CATEGORIES = ['personal or veiled attack', 'drugs or sex', 'politics or culture war', 'cynical or depressive looping', 'repeating the same point', 'emotion-only hype'];
// The Developer Trust filter's output (config/grader-prompt.md).
export const ObjectivesSchema = z.object({
  score: z.number(),
  bucket: z.enum(['kill', 'low', 'middle', 'sweet']),
  why: z.string(),
  kill: z.object({ category: z.enum(KILL_CATEGORIES), span: z.string() }).nullable(),
  objective_id: z.string().nullable(),
  steps: z.array(Step),
  no_steps_reason: z.string().nullable(),
  tmi: z.array(Tmi),
  lawyer: z.object({ stance: z.enum(['ship', 'fix', 'kill']), take: z.string(), confidence: z.enum(['low', 'medium', 'high']) }),
});
const SCHEMAS = { score: ObjectivesSchema, compare: CompareSchema, algo: AlgoSchema, critique: CritiqueSchema };
export const MODES = Object.keys(SCHEMAS);

export function validateRequest(b) {
  if (!b || typeof b !== 'object') return 'body must be a JSON object';
  if (!['x', 'linkedin'].includes(b.platform)) return 'platform must be "x" or "linkedin"';
  if (typeof b.post_text !== 'string' || !b.post_text.trim()) return 'post_text is required';
  if (b.post_text.length > 40000) return 'post_text is too long';
  if (b.mode != null && !MODES.includes(b.mode)) return `mode must be one of ${MODES.join(', ')}`;
  if (b.objective_id != null && typeof b.objective_id !== 'string') return 'objective_id must be a string or null';
  if (b.objectives != null && (typeof b.objectives !== 'object' || !Array.isArray(b.objectives.objectives))) return 'objectives must be an objectives.json document';
  return null;
}

export const MODEL_ID = MODEL;
export const EFFORT_LEVEL = EFFORT;

const client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
// Fast mode: same model, up to ~2.5x faster output at premium pricing. SUPERTWEET_FAST=0 turns it off.
const FAST = process.env.SUPERTWEET_FAST !== '0';
let fastUnavailable = false;
const cache = new Map();
const CACHE_MAX = 500;

// One "score" call (the pipeline in pipeline.mjs runs three and takes the median).
export async function grade(b) {
  const objectives = b.objectives && Array.isArray(b.objectives.objectives) ? b.objectives : loadObjectives();
  const request = { mode: 'score', platform: b.platform, title: b.title || null, post_text: b.post_text, objective_id: b.objective_id || null, attachments: Array.isArray(b.attachments) ? b.attachments.slice(0, 4).map(String) : [], deterministic_checks: b.checks || null, app_stats: b.app_stats || undefined, avoid: b.avoid || undefined, verify: b.verify || undefined };
  return callModel('score', request, objectives);
}

// Any mode, with its structured-output schema. The strongest model (Opus) for every call: grading
// only runs when you press Grade, so there are no cheaper "live" calls to make.
export async function callModel(mode, request, objectivesDoc) {
  const objectives = objectivesDoc && Array.isArray(objectivesDoc.objectives) ? objectivesDoc : loadObjectives();
  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: betaZodOutputFormat(SCHEMAS[mode] || ObjectivesSchema) },
    system: [
      { type: 'text', text: PROMPT + ADDENDUM },
      { type: 'text', text: `Objectives:\n${JSON.stringify(objectives)}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: JSON.stringify({ ...request, mode }) }],
  };
  let response;
  if (FAST && !fastUnavailable) {
    try {
      response = await client.beta.messages.parse({ ...params, speed: 'fast', betas: [...params.betas, 'fast-mode-2026-02-01'] });
    } catch (e) {
      // Fast mode has its own rate limit and isn't on every account: fall back to standard speed.
      if (e instanceof Anthropic.BadRequestError) fastUnavailable = true;
      if (!(e instanceof Anthropic.BadRequestError || e instanceof Anthropic.RateLimitError)) throw e;
    }
  }
  if (!response) response = await client.beta.messages.parse(params);
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error(`grader refused (${response.stop_details?.category || 'unknown'})`), { status: 502 });
  }
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('grader ran out of tokens'), { status: 502 });
  if (!response.parsed_output) throw Object.assign(new Error('grader returned unparseable output'), { status: 502 });
  return { ...response.parsed_output, model: response.model };
}

// One cache key per exact request + audience set.
export const cacheKey = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

export function resolveSet(id) {
  if (!id) return { set: null };
  const set = loadAudienceSets().find((x) => x.audience_set === id) || null;
  return set ? { set } : { error: `audience set "${id}" not found` };
}

export function apiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return { status: 502, message: 'Anthropic API key missing or invalid' };
  if (err instanceof Anthropic.RateLimitError) return { status: 503, message: 'rate limited, retry shortly' };
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { status: 504, message: 'grader timed out' };
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, message: 'cannot reach Anthropic API' };
  if (err instanceof Anthropic.APIError) return { status: 502, message: `Anthropic API error ${err.status}` };
  return { status: err.status || 500, message: err.message };
}

// The pipeline (three grades + median, steps, X analysis, Tune for X), on the real model.
export const pipeline = createPipeline({ model: callModel });

// Request extras the clients send: the author's app stats and the last 10 things they rejected.
export function cleanExtras(b) {
  const st = b && b.app_stats && typeof b.app_stats === 'object' ? b.app_stats : {};
  const app_stats = {};
  for (const k of ['drafts_scored', 'average_score', 'posts_through_gate']) if (typeof st[k] === 'number' && Number.isFinite(st[k])) app_stats[k] = st[k];
  if (Array.isArray(st.most_failed_checks)) app_stats.most_failed_checks = st.most_failed_checks.slice(0, 3).map((x) => String(x).slice(0, 80));
  const avoid = (Array.isArray(b && b.avoid) ? b.avoid : []).slice(-10).map((a) => Object.fromEntries(['kind', 'type', 'title', 'line_before', 'line_after', 'gate', 'reason'].filter((k) => a && a[k] != null).map((k) => [k, String(a[k]).slice(0, 400)])));
  return { app_stats, avoid };
}
