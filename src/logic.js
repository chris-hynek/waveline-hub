// Pure business logic: quotes, commissions, permissions. Unit tested.
const PRICE_PER_SEAT = 50;
const ROLES = ['owner', 'sales_manager', 'salesperson'];
const STAGES = ['Lead', 'Contacted', 'Quoted', 'Negotiating', 'Won', 'Lost'];

function round2(n) { return Math.round(n * 100) / 100; }

/** Bill comparison. bill = { seats, lines:[{label, amount}], provider } */
function computeQuote(bill, pricePerSeat = PRICE_PER_SEAT) {
  const seats = Math.max(1, parseInt(bill.seats, 10) || 1);
  const lines = (bill.lines || []).filter(l => l && l.label !== undefined)
    .map(l => ({ label: String(l.label || 'Line item'), amount: round2(Number(l.amount) || 0) }));
  const currentMonthly = round2(lines.reduce((s, l) => s + l.amount, 0));
  const wavelineMonthly = round2(seats * pricePerSeat);
  const monthlySavings = round2(currentMonthly - wavelineMonthly);
  return {
    seats, lines, provider: bill.provider || 'Unknown',
    currentMonthly, wavelineMonthly, monthlySavings,
    annualSavings: round2(monthlySavings * 12),
    savingsPct: currentMonthly > 0 ? round2((monthlySavings / currentMonthly) * 100) : 0,
    currentPerSeat: round2(currentMonthly / seats),
    saves: monthlySavings > 0,
  };
}

/** Commission for one rep. rules = { base_pct, spiffs:[{id,name,type:'pct_of_mrr'|'flat',value,min_seats,from_competitor,active}] } */
function computeCommission(rules, deals, payments) {
  const basePct = Number(rules.base_pct) || 0;
  const collected = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const base = round2(collected * basePct / 100);
  const spiffLines = [];
  for (const d of deals.filter(d => d.stage === 'Won')) {
    const mrr = (Number(d.seats) || 0) * PRICE_PER_SEAT;
    for (const sp of (rules.spiffs || []).filter(s => s.active !== false)) {
      if (sp.min_seats && (Number(d.seats) || 0) < sp.min_seats) continue;
      if (sp.from_competitor && !(d.current_provider || '').trim()) continue;
      const amt = sp.type === 'flat' ? Number(sp.value) : mrr * Number(sp.value) / 100;
      spiffLines.push({ spiff: sp.name, customer: d.business, amount: round2(amt) });
    }
  }
  const spiffTotal = round2(spiffLines.reduce((s, l) => s + l.amount, 0));
  return { collected, basePct, base, spiffLines, spiffTotal, total: round2(base + spiffTotal) };
}

const DEFAULT_TIER_ACCESS = {
  sales_manager: { today: true, customers: true, quotes: true, coach: true, reports: true, team_reports: true },
  salesperson: { today: true, customers: true, quotes: true, coach: true, reports: true, team_reports: false },
};

/** Which customers a user may see: returns a SQL fragment + params. */
function customerScope(user) {
  if (user.role === 'owner') return { where: '1=1', params: [] };
  if (user.role === 'sales_manager') return { where: '(c.owner_id = ? OR c.owner_id IN (SELECT id FROM users WHERE manager_id = ?))', params: [user.id, user.id] };
  return { where: 'c.owner_id = ?', params: [user.id] };
}

function canAccessPage(user, page, tierAccess = DEFAULT_TIER_ACCESS) {
  if (user.role === 'owner') return true;
  if (page === 'settings') return false;
  const t = tierAccess[user.role] || {};
  return t[page] !== false;
}

module.exports = { PRICE_PER_SEAT, ROLES, STAGES, computeQuote, computeCommission, DEFAULT_TIER_ACCESS, customerScope, canAccessPage, round2 };
