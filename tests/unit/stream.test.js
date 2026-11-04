const test = require('node:test'); const assert = require('node:assert'); const wave = require('../../src/wave');
const sse = (objs) => ({ ok: true, body: (async function* () { for (const o of objs) yield Buffer.from(`data: ${JSON.stringify(o)}\n\n`); yield Buffer.from('data: [DONE]\n\n'); })() });
test('streaming: tool call deltas assembled, text deltas forwarded', async () => {
  const rounds = [
    sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'navigate', arguments: '{"pa' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ge":"coach"}' } }] } }] }]),
    sse([{ choices: [{ delta: { content: 'Opened ' } }] }, { choices: [{ delta: { content: 'Coach.' } }] }]),
  ];
  const deltas = [], acts = [];
  const out = await wave.chat({ messages: [{ role: 'user', content: 'x' }], user: { name: 'T', role: 'rep' }, page: 'today', listCustomers: () => [], env: { OPENAI_API_KEY: 'k' }, fetchImpl: async () => rounds.shift(), onDelta: d => deltas.push(d), onAction: a => acts.push(a) });
  assert.equal(out.reply, 'Opened Coach.'); assert.deepEqual(deltas, ['Opened ', 'Coach.']); assert.deepEqual(acts, [{ type: 'navigate', page: 'coach' }]);
});
