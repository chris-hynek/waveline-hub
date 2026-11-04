const test = require('node:test'); const assert = require('node:assert');
const { open, setSetting } = require('../../src/db');
const slack = require('../../src/slack'); const wave = require('../../src/wave');
test('slack: dry-run by default, never calls fetch', async () => {
  const db = open(':memory:'); let called = false;
  const r = await slack.notify(db, 'deal_won', { business: 'X', seats: 3, rep: 'R' }, { fetchImpl: () => { called = true; }, env: { SLACK_WEBHOOK_URL: 'https://hooks.example/x' } });
  assert.equal(r.status, 'dry_run'); assert.equal(called, false); assert.equal(r.channel, '#sales-wins'); assert.match(r.text, /\$150\.00\/mo/);
});
test('slack: live only when env + owner toggle both allow it', async () => {
  const db = open(':memory:'); setSetting(db, 'slack', { enabled: true, channels: { payments: '#fin' }, events: {} }); const calls = [];
  const r = await slack.notify(db, 'payment', { business: 'X', amount: 10, rep: 'R' }, { fetchImpl: async (u, o) => { calls.push([u, JSON.parse(o.body)]); return { ok: true }; }, env: { SLACK_LIVE: 'true', SLACK_BOT_TOKEN: 'xoxb-test' } });
  assert.equal(r.status, 'sent'); assert.equal(calls[0][1].channel, '#fin');
});
test('slack: event toggle off skips', async () => { const db = open(':memory:'); setSetting(db, 'slack', { enabled: false, channels: {}, events: { spiff: false } }); assert.equal(await slack.notify(db, 'spiff', {}), null); });
test('wave: knowledge search finds battlecards and scripts', () => {
  assert.equal(wave.searchKnowledge('Quo transfers')[0].title, 'Quo (formerly OpenPhone)');
  assert.ok(wave.searchKnowledge('restaurant cold call').some(i => i.kind === 'script'));
});
test('wave: no key -> NO_KEY error', async () => { await assert.rejects(wave.chat({ messages: [], user: {}, env: {} }), (e) => e.code === 'NO_KEY'); });
test('wave: tool calls become client actions (draft, not saved)', async () => {
  const replies = [
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'navigate', arguments: '{"page":"customers"}' } }, { id: '2', type: 'function', function: { name: 'fill_form', arguments: '{"form":"customer","fields":{"business":"Joe\'s Diner","seats":4}}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'Filled it in. Hit Save, champ.' } }] }];
  let i = 0; const fetchImpl = async (url, o) => { assert.match(url, /chat\/completions$/); assert.ok(JSON.parse(o.body).tools.length >= 4); return { ok: true, json: async () => replies[i++] }; };
  const r = await wave.chat({ messages: [{ role: 'user', content: 'add joe' }], user: { name: 'R', role: 'salesperson' }, page: 'today', listCustomers: () => [], env: { OPENAI_API_KEY: 'k' }, fetchImpl });
  assert.equal(r.reply, 'Filled it in. Hit Save, champ.'); assert.deepEqual(r.actions.map(a => a.type), ['navigate', 'fill_form']); assert.equal(r.actions[1].fields.business, "Joe's Diner");
});
