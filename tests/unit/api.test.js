const test = require('node:test'); const assert = require('node:assert');
const { startServer, login, EMAILS } = require('../helpers');
let S; test.before(async () => { S = await startServer(); }); test.after(() => S.close());

test('auth: bad password, empty fields, unauthenticated', async () => {
  assert.equal((await login(S.base, EMAILS.owner, 'nope')).status, 401);
  assert.equal((await login(S.base, '', '')).status, 400);
  assert.equal((await fetch(S.base + '/api/me')).status, 401);
});
test('scope: owner sees all, manager sees team, rep sees own', async () => {
  const o = await login(S.base, EMAILS.owner), m = await login(S.base, EMAILS.manager), r = await login(S.base, EMAILS.rep);
  assert.equal((await o.call('/customers')).data.length, 6);
  const mine = (await m.call('/customers')).data; assert.equal(mine.length, 4); assert.ok(!mine.some(c => c.business.includes('ByteFix')));
  const rc = (await r.call('/customers')).data; assert.equal(rc.length, 2); assert.ok(rc.every(c => c.owner_id === S.ids.rep));
  const other = (await o.call('/customers')).data.find(c => c.business.includes('ByteFix'));
  assert.equal((await r.call('/customers/' + other.id)).status, 404);
  assert.equal((await r.call('/customers/' + other.id, { method: 'PUT', body: { stage: 'Won' } })).status, 404);
});
test('rep cannot assign to others, cannot delete, cannot reach settings', async () => {
  const r = await login(S.base, EMAILS.rep);
  assert.equal((await r.call('/customers', { method: 'POST', body: { business: 'X', owner_id: S.ids.rep2 } })).status, 403);
  const c = (await r.call('/customers', { method: 'POST', body: { business: '[TEST] Rep Co', is_test: true } })).data;
  assert.equal(c.owner_id, S.ids.rep);
  assert.equal((await r.call('/customers/' + c.id, { method: 'DELETE' })).status, 403);
  assert.equal((await r.call('/settings')).status, 403);
  assert.equal((await r.call('/users', { method: 'POST', body: { email: 'a@b.c', name: 'a', role: 'owner', password: '12345678' } })).status, 403);
  const me = (await r.call('/me')).data; assert.ok(!me.pages.includes('settings'));
});
test('won deal + payment produce dry-run Slack events and commission', async () => {
  const o = await login(S.base, EMAILS.owner), r = await login(S.base, EMAILS.rep);
  const joe = (await r.call('/customers')).data.find(c => c.business.includes('Joe'));
  assert.equal((await r.call('/customers/' + joe.id, { method: 'PUT', body: { stage: 'Won' } })).data.stage, 'Won');
  assert.equal((await r.call(`/customers/${joe.id}/payments`, { method: 'POST', body: { amount: 200 } })).status, 201);
  assert.equal((await r.call(`/customers/${joe.id}/payments`, { method: 'POST', body: { amount: -5 } })).status, 400);
  const log = (await o.call('/slack/outbox')).data; assert.ok(log.some(l => l.event === 'deal_won' && l.text.includes('Joe'))); assert.ok(log.some(l => l.event === 'spiff')); assert.ok(log.every(l => l.status === 'dry_run'));
  const rep = (await r.call('/reports')).data.reps; assert.equal(rep.length, 1); assert.ok(rep[0].total > 0);
});
test('tier access: owner can hide team reports and coach from salespeople', async () => {
  const o = await login(S.base, EMAILS.owner), r = await login(S.base, EMAILS.rep), m = await login(S.base, EMAILS.manager);
  const s = (await o.call('/settings')).data; s.tier_access.salesperson.coach = false;
  await o.call('/settings/tier_access', { method: 'PUT', body: s.tier_access });
  assert.equal((await r.call('/knowledge')).status, 403);
  assert.equal((await m.call('/knowledge')).status, 200);
  assert.ok((await m.call('/reports')).data.reps.length >= 2);
  s.tier_access.salesperson.coach = true; await o.call('/settings/tier_access', { method: 'PUT', body: s.tier_access });
});
test('owner manages users, deactivated user cannot log in', async () => {
  const o = await login(S.base, EMAILS.owner);
  const u = (await o.call('/users', { method: 'POST', body: { email: 'new@test.waveline.local', name: 'New (TEST)', role: 'salesperson', password: 'TestPass!2026', is_test: true } })).data;
  assert.equal((await login(S.base, 'new@test.waveline.local')).status, 200);
  await o.call('/users/' + u.id, { method: 'PUT', body: { active: false } });
  assert.equal((await login(S.base, 'new@test.waveline.local')).status, 401);
  assert.equal((await o.call('/users/' + S.ids.owner, { method: 'PUT', body: { role: 'salesperson' } })).status, 400);
  assert.equal((await o.call('/settings/commission_rules', { method: 'PUT', body: { base_pct: 150, spiffs: [] } })).status, 400);
});
test('wave chat without key returns setup message', async () => {
  const r = await login(S.base, EMAILS.rep); const res = await r.call('/wave/chat', { method: 'POST', body: { messages: [] } });
  assert.equal(res.status, 503); assert.match(res.data.setup, /OPENAI_API_KEY/);
});
