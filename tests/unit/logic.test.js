const test = require('node:test'); const assert = require('node:assert');
const L = require('../../src/logic');
test('computeQuote: savings math', () => {
  const r = L.computeQuote({ seats: 4, provider: 'Spectrum', lines: [{ label: 'Lines', amount: 200 }, { label: 'Fees', amount: '60' }] });
  assert.equal(r.currentMonthly, 260); assert.equal(r.wavelineMonthly, 200); assert.equal(r.monthlySavings, 60); assert.equal(r.annualSavings, 720); assert.equal(r.saves, true); assert.equal(r.currentPerSeat, 65);
});
test('computeQuote: negative savings and bad input', () => {
  const r = L.computeQuote({ seats: 'x', lines: [{ label: 'a', amount: 'abc' }] });
  assert.equal(r.seats, 1); assert.equal(r.currentMonthly, 0); assert.equal(r.monthlySavings, -50); assert.equal(r.saves, false); assert.equal(r.savingsPct, 0);
});
test('computeCommission: base + spiffs with conditions', () => {
  const rules = { base_pct: 10, spiffs: [{ name: 'Switch', type: 'pct_of_mrr', value: 25, from_competitor: true }, { name: 'Big', type: 'flat', value: 150, min_seats: 10 }, { name: 'Off', type: 'flat', value: 999, active: false }] };
  const deals = [{ business: 'A', stage: 'Won', seats: 12, current_provider: 'Grasshopper' }, { business: 'B', stage: 'Won', seats: 2, current_provider: '' }, { business: 'C', stage: 'Lead', seats: 50 }];
  const r = L.computeCommission(rules, deals, [{ amount: 600 }, { amount: 100 }]);
  assert.equal(r.base, 70); assert.equal(r.spiffLines.length, 2); assert.equal(r.spiffTotal, 300); assert.equal(r.total, 370);
});
test('canAccessPage respects tiers', () => {
  assert.equal(L.canAccessPage({ role: 'owner' }, 'settings'), true);
  assert.equal(L.canAccessPage({ role: 'sales_manager' }, 'settings'), false);
  assert.equal(L.canAccessPage({ role: 'salesperson' }, 'coach', { salesperson: { coach: false } }), false);
  assert.equal(L.canAccessPage({ role: 'salesperson' }, 'quotes'), true);
});
