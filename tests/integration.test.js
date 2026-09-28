'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, plain } = require('./harness');
const payloads = require('../sample_data/intake_payloads.json');

const ctx = load(['RestRetryPolicy.js', 'PayloadMapper.js', 'OutboundRestClient.js', 'IncidentIntakeService.js']);

test('retry policy: retryable codes only, capped attempts', () => {
  const p = new ctx.RestRetryPolicy({ maxAttempts: 3 });
  assert.strictEqual(p.shouldRetry(1, 503), true);
  assert.strictEqual(p.shouldRetry(1, 404), false);
  assert.strictEqual(p.shouldRetry(1, 0, 'ETIMEDOUT'), true);
  assert.strictEqual(p.shouldRetry(3, 503), false);
});

test('retry policy: backoff with jitter and Retry-After', () => {
  const p = new ctx.RestRetryPolicy({ baseMs: 1000, maxDelayMs: 5000, random: () => 0.999 });
  assert.strictEqual(p.delayMs(1), 999);
  assert.strictEqual(p.delayMs(3), 3996);
  assert.strictEqual(p.delayMs(10), 4995);   // capped
  assert.strictEqual(p.delayMs(1, '7'), 5000); // Retry-After capped too
  assert.strictEqual(p.delayMs(1, '2'), 2000);
});

test('outbound client retries then succeeds and logs once', () => {
  const responses = [{ status: 503 }, { status: 0, errorCode: 1, errorMessage: 'timeout' },
                     { status: 201, body: '{"id":"V-9"}' }];
  const logs = [], sleeps = [];
  const client = new ctx.OutboundRestClient({
    transport: () => responses.shift(), sleep: (ms) => sleeps.push(ms),
    logger: (req, res) => logs.push(res),
    policy: new ctx.RestRetryPolicy({ random: () => 0 })
  });
  const r = client.send({ body: { a: 1 }, correlationId: 'INC001' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 3);
  assert.strictEqual(r.body.id, 'V-9');
  assert.strictEqual(sleeps.length, 2);
  assert.strictEqual(logs.length, 1);
});

test('outbound client does not retry 400', () => {
  let calls = 0;
  const client = new ctx.OutboundRestClient({
    transport: () => { calls++; return { status: 400, body: 'bad' }; },
    sleep: () => {}, logger: () => {}
  });
  const r = client.send({});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'HTTP 400');
  assert.strictEqual(calls, 1);
});

test('payload mapper: nested paths, transforms, value maps, reverse', () => {
  const m = new ctx.PayloadMapper([
    { from: 'a.b', to: 'x', transform: 'trim', required: true },
    { from: 'p', to: 'priority', map: { P1: '1', P2: '2' } },
    { from: 'q', to: 'out.deep', 'default': 'd' }
  ]);
  const r = m.map({ a: { b: ' hi ' }, p: 'P2' });
  assert.deepStrictEqual(plain(r.data), { x: 'hi', priority: '2', out: { deep: 'd' } });
  const back = m.map({ x: 'hi', priority: '1', out: { deep: 'z' } }, true);
  assert.deepStrictEqual(plain(back.data), { a: { b: 'hi' }, p: 'P1', q: 'z' });
  assert.match(m.map({ a: { b: 'x' }, p: 'P9' }).errors[0], /unmapped value "P9"/);
});

test('intake: new alert creates incident with mapped fields', () => {
  const svc = new ctx.IncidentIntakeService({ findByCorrelation: () => null });
  const r = svc.process(payloads[0]);
  assert.strictEqual(r.action, 'create');
  assert.deepStrictEqual(plain(r.fields), {
    correlation_id: 'ALRT-1001', u_source_system: 'monitoring', short_description: 'Disk usage 95% on db01',
    impact: '2', urgency: '1', u_service_name: 'Payments DB', u_caller_email: 'noc@example.com'
  });
});

test('intake: repeat alert updates without downgrading severity', () => {
  const svc = new ctx.IncidentIntakeService({
    findByCorrelation: () => ({ sys_id: 's1', number: 'INC0010001', state: '2', impact: '2', urgency: '1' })
  });
  const r = svc.process(payloads[1]);
  assert.strictEqual(r.action, 'update');
  assert.strictEqual(r.fields.impact, '2');  // minor (3) would downgrade, kept at 2
  assert.strictEqual(r.fields.urgency, '1'); // default medium (2) kept at 1
});

test('intake: closed incident with same id creates a new one', () => {
  const svc = new ctx.IncidentIntakeService({ findByCorrelation: () => ({ sys_id: 's1', number: 'INC9', state: '7' }) });
  const r = svc.process(payloads[1]);
  assert.strictEqual(r.action, 'create');
  assert.strictEqual(r.reopenedFrom, 'INC9');
});

test('intake: validation errors return 400', () => {
  const svc = new ctx.IncidentIntakeService({ findByCorrelation: () => null });
  assert.match(svc.process(payloads[2]).errors.join(), /source_id is required/);
  assert.match(svc.process(payloads[3]).errors.join(), /unmapped value "sev0"/);
  assert.strictEqual(svc.process(null).status, 400);
});
