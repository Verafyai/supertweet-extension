import test from 'node:test';
import assert from 'node:assert';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ObjectivesSchema, validateRequest, originAllowed, createServer, loadAudienceSets } from './server.mjs';
import { CompareSchema, AlgoSchema, CritiqueSchema } from './grader.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));

test('error classes used by the server exist', () => {
  for (const k of ['AuthenticationError', 'RateLimitError', 'APIConnectionTimeoutError', 'APIConnectionError', 'APIError']) assert.ok(Anthropic[k], k);
});

test('every mode schema converts to a structured-output format', () => {
  for (const S of [ObjectivesSchema, CompareSchema, AlgoSchema, CritiqueSchema]) assert.ok(betaZodOutputFormat(S).schema, 'has JSON schema');
});

test('request validation', () => {
  assert.match(validateRequest({ platform: 'myspace', post_text: 'x' }), /platform/);
  assert.match(validateRequest({ platform: 'x', post_text: '  ' }), /post_text/);
  assert.match(validateRequest({ platform: 'x', post_text: 'hi', mode: 'panel' }), /mode must be/);
  assert.strictEqual(validateRequest({ platform: 'linkedin', post_text: 'hi', mode: 'score', objective_id: 'agent-builder' }), null);
});

test('only the extension or local clients may call it', () => {
  assert.ok(originAllowed(undefined));
  assert.ok(originAllowed('chrome-extension://abc'));
  assert.ok(!originAllowed('https://evil.example'));
  assert.ok(!originAllowed('https://x.com'));
});

test('HTTP: web origin rejected, bad body rejected, health ok', async () => {
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const evil = await fetch(`${base}/grade`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
  assert.strictEqual(evil.status, 403);
  const bad = await fetch(`${base}/grade`, { method: 'POST', body: '{"platform":"x"}' });
  assert.strictEqual(bad.status, 400);
  const health = await (await fetch(`${base}/health`)).json();
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.model, 'claude-opus-5-5');
  srv.close();
});
