const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { getSetting, setSetting } = require('./db');
const L = require('./logic');
const slack = require('./slack');
const wave = require('./wave');
const competitors = require('./data/competitors.json');
const kb = require('./data/knowledge.json');

function createApp(db, { env = process.env } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const q = (sql) => db.prepare(sql);
  const audit = (uid, action, detail) => q('INSERT INTO audit (user_id, action, detail) VALUES (?,?,?)').run(uid, action, JSON.stringify(detail || {}));
  const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, manager_id: u.manager_id, active: !!u.active, is_test: !!u.is_test, voice_consent: !!u.voice_consent_at });
  const bad = (res, code, error) => res.status(code).json({ error });

  // ---- auth ----
  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return bad(res, 400, 'Enter your email and password.');
    const u = q('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
    if (!u || !u.active || !bcrypt.compareSync(String(password), u.password_hash)) return bad(res, 401, 'That email and password don\'t match.');
    const token = crypto.randomBytes(32).toString('hex');
    q('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + 7 * 864e5);
    res.cookie('wl_session', token, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', maxAge: 7 * 864e5 });
    res.json({ user: publicUser(u) });
  });
  app.post('/api/logout', (req, res) => { q('DELETE FROM sessions WHERE token = ?').run(req.cookies.wl_session || ''); res.clearCookie('wl_session'); res.json({ ok: true }); });

  const auth = (req, res, next) => {
    const s = q('SELECT * FROM sessions WHERE token = ?').get(req.cookies.wl_session || '');
    if (!s || s.expires_at < Date.now()) return bad(res, 401, 'Please sign in.');
    const u = q('SELECT * FROM users WHERE id = ? AND active = 1').get(s.user_id);
    if (!u) return bad(res, 401, 'Please sign in.');
    req.user = u; next();
  };
  const owner = (req, res, next) => req.user.role === 'owner' ? next() : bad(res, 403, 'Owner only.');
  const page = (p) => (req, res, next) => L.canAccessPage(req.user, p, getSetting(db, 'tier_access')) ? next() : bad(res, 403, 'Your tier does not have access to this.');

  app.use('/api', auth);

  app.get('/api/me', (req, res) => {
    const ta = getSetting(db, 'tier_access');
    const pages = ['today', 'customers', 'quotes', 'coach', 'reports', 'settings'].filter(p => L.canAccessPage(req.user, p, ta));
    res.json({ user: publicUser(req.user), pages, ai: wave.aiConfigured(env), stages: L.STAGES, price: L.PRICE_PER_SEAT });
  });
  app.post('/api/me/voice-consent', (req, res) => { q('UPDATE users SET voice_consent_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id); res.json({ ok: true }); });

  // ---- customers ----
  const scoped = (user, extra = '', params = []) => { const s = L.customerScope(user); return q(`SELECT c.*, u.name AS owner_name FROM customers c LEFT JOIN users u ON u.id = c.owner_id WHERE ${s.where} ${extra}`).all(...s.params, ...params); };
  const getVisible = (user, id) => scoped(user, 'AND c.id = ?', [id])[0];
  const visibleRepIds = (user) => user.role === 'owner' ? q('SELECT id FROM users').all().map(r => r.id)
    : user.role === 'sales_manager' ? [user.id, ...q('SELECT id FROM users WHERE manager_id = ?').all(user.id).map(r => r.id)] : [user.id];
  const CFIELDS = ['business', 'contact', 'phone', 'email', 'industry', 'stage', 'seats', 'current_provider', 'current_monthly', 'contract_end', 'next_step', 'next_step_date', 'owner_id', 'is_test'];
  function cleanCustomer(body, user, existing) {
    const c = {};
    for (const f of CFIELDS) if (body[f] !== undefined) c[f] = body[f] === '' ? null : body[f];
    if (c.stage && !L.STAGES.includes(c.stage)) throw Object.assign(new Error('Unknown stage.'), { status: 400 });
    if (c.seats != null) c.seats = Math.max(1, parseInt(c.seats, 10) || 1);
    if (c.current_monthly != null) c.current_monthly = Number(c.current_monthly) || 0;
    if (c.is_test != null) c.is_test = c.is_test ? 1 : 0;
    if (c.owner_id != null) { c.owner_id = Number(c.owner_id); if (!visibleRepIds(user).includes(c.owner_id)) throw Object.assign(new Error('You can only assign customers to your team.'), { status: 403 }); }
    if (!existing && !c.owner_id) c.owner_id = user.id;
    if (!existing && !c.business) throw Object.assign(new Error('Business name is required.'), { status: 400 });
    return c;
  }
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { bad(res, e.status || 500, e.message); } };

  app.get('/api/customers', page('customers'), (req, res) => res.json(scoped(req.user, 'ORDER BY c.updated_at DESC')));
  app.get('/api/customers/:id', page('customers'), (req, res) => {
    const c = getVisible(req.user, Number(req.params.id)); if (!c) return bad(res, 404, 'Not found.');
    c.notes = q('SELECT n.*, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE customer_id = ? ORDER BY n.id DESC').all(c.id);
    c.payments = q('SELECT * FROM payments WHERE customer_id = ? ORDER BY paid_on DESC').all(c.id);
    c.quotes = q('SELECT * FROM quotes WHERE customer_id = ? ORDER BY id DESC').all(c.id).map(x => ({ ...x, data: JSON.parse(x.data) }));
    res.json(c);
  });
  async function onWon(cust, user) {
    await slack.notify(db, 'deal_won', { business: cust.business, seats: cust.seats, rep: cust.owner_name || user.name });
    const rules = getSetting(db, 'commission_rules');
    const r = L.computeCommission(rules, [cust], []);
    for (const l of r.spiffLines) await slack.notify(db, 'spiff', { rep: cust.owner_name || user.name, amount: l.amount, spiff: l.spiff, business: cust.business });
  }
  app.post('/api/customers', page('customers'), wrap(async (req, res) => {
    const c = cleanCustomer(req.body || {}, req.user, null);
    if (c.stage === 'Won') c.won_at = new Date().toISOString().slice(0, 10);
    const keys = Object.keys(c);
    const id = q(`INSERT INTO customers (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => c[k])).lastInsertRowid;
    audit(req.user.id, 'customer.create', { id });
    const cust = getVisible(req.user, Number(id));
    if (cust.stage === 'Won') await onWon(cust, req.user);
    res.status(201).json(cust);
  }));
  app.put('/api/customers/:id', page('customers'), wrap(async (req, res) => {
    const existing = getVisible(req.user, Number(req.params.id)); if (!existing) return bad(res, 404, 'Not found.');
    const c = cleanCustomer(req.body || {}, req.user, existing);
    if (c.stage === 'Won' && existing.stage !== 'Won') c.won_at = new Date().toISOString().slice(0, 10);
    const keys = Object.keys(c); if (!keys.length) return res.json(existing);
    q(`UPDATE customers SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...keys.map(k => c[k]), existing.id);
    audit(req.user.id, 'customer.update', { id: existing.id, fields: keys });
    const cust = getVisible(req.user, existing.id);
    if (c.stage === 'Won' && existing.stage !== 'Won') await onWon(cust, req.user);
    res.json(cust);
  }));
  app.delete('/api/customers/:id', page('customers'), (req, res) => {
    if (req.user.role === 'salesperson') return bad(res, 403, 'Ask your manager to delete customers.');
    const c = getVisible(req.user, Number(req.params.id)); if (!c) return bad(res, 404, 'Not found.');
    q('DELETE FROM customers WHERE id = ?').run(c.id); audit(req.user.id, 'customer.delete', { id: c.id }); res.json({ ok: true });
  });
  app.post('/api/customers/:id/notes', page('customers'), (req, res) => {
    const c = getVisible(req.user, Number(req.params.id)); if (!c) return bad(res, 404, 'Not found.');
    const body = String((req.body || {}).body || '').trim(); if (!body) return bad(res, 400, 'Write a note first.');
    const id = q('INSERT INTO notes (customer_id, user_id, body) VALUES (?,?,?)').run(c.id, req.user.id, body).lastInsertRowid;
    q('UPDATE customers SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(c.id);
    res.status(201).json(q('SELECT * FROM notes WHERE id = ?').get(id));
  });
  app.post('/api/customers/:id/payments', page('customers'), wrap(async (req, res) => {
    const c = getVisible(req.user, Number(req.params.id)); if (!c) return bad(res, 404, 'Not found.');
    const amount = Number((req.body || {}).amount); if (!(amount > 0)) return bad(res, 400, 'Enter a payment amount above $0.');
    const paid_on = req.body.paid_on || new Date().toISOString().slice(0, 10);
    const id = q('INSERT INTO payments (customer_id, user_id, amount, paid_on, memo) VALUES (?,?,?,?,?)').run(c.id, req.user.id, amount, paid_on, req.body.memo || null).lastInsertRowid;
    audit(req.user.id, 'payment.create', { id, customer: c.id });
    await slack.notify(db, 'payment', { business: c.business, amount, rep: req.user.name });
    res.status(201).json(q('SELECT * FROM payments WHERE id = ?').get(id));
  }));

  // ---- quotes ----
  app.post('/api/quotes/preview', page('quotes'), (req, res) => res.json(L.computeQuote(req.body || {})));
  app.post('/api/quotes', page('quotes'), (req, res) => {
    const b = req.body || {};
    const c = b.customer_id ? getVisible(req.user, Number(b.customer_id)) : null;
    if (!c) return bad(res, 400, 'Pick a customer for this quote.');
    const r = L.computeQuote(b);
    const id = q('INSERT INTO quotes (customer_id, user_id, data, monthly_savings) VALUES (?,?,?,?)').run(c.id, req.user.id, JSON.stringify(r), r.monthlySavings).lastInsertRowid;
    const upd = { current_provider: r.provider, current_monthly: r.currentMonthly, seats: r.seats };
    if (['Lead', 'Contacted'].includes(c.stage)) upd.stage = 'Quoted';
    const keys = Object.keys(upd);
    q(`UPDATE customers SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...keys.map(k => upd[k]), c.id);
    res.status(201).json({ id, ...r });
  });
  app.get('/api/quotes', page('quotes'), (req, res) => {
    const s = L.customerScope(req.user);
    res.json(q(`SELECT qt.id, qt.customer_id, qt.monthly_savings, qt.created_at, c.business FROM quotes qt JOIN customers c ON c.id = qt.customer_id WHERE ${s.where} ORDER BY qt.id DESC LIMIT 20`).all(...s.params));
  });

  // ---- today ----
  app.get('/api/today', (req, res) => {
    const cs = scoped(req.user);
    const open = cs.filter(c => !['Won', 'Lost'].includes(c.stage));
    const today = new Date().toISOString().slice(0, 10);
    const due = open.filter(c => c.next_step_date && c.next_step_date <= today).sort((a, b) => a.next_step_date.localeCompare(b.next_step_date));
    const soonContract = open.filter(c => c.contract_end).map(c => ({ ...c, days: Math.round((new Date(c.contract_end) - new Date(today)) / 864e5) })).filter(c => c.days <= 60);
    const pipeline = open.reduce((s, c) => s + c.seats * L.PRICE_PER_SEAT, 0);
    const won = cs.filter(c => c.stage === 'Won');
    const next = due[0] || open.sort((a, b) => L.STAGES.indexOf(b.stage) - L.STAGES.indexOf(a.stage))[0] || null;
    res.json({ next, due: due.slice(0, 5), contracts: soonContract.slice(0, 5), stats: { open: open.length, pipelineMrr: pipeline, wonMrr: won.reduce((s, c) => s + c.seats * L.PRICE_PER_SEAT, 0), won: won.length } });
  });

  // ---- reports ----
  app.get('/api/reports', page('reports'), (req, res) => {
    const ta = getSetting(db, 'tier_access'); const rules = getSetting(db, 'commission_rules');
    let ids = visibleRepIds(req.user);
    if (req.user.role !== 'owner' && !(ta[req.user.role] || {}).team_reports) ids = [req.user.id];
    const { from = '0000-00-00', to = '9999-99-99' } = req.query;
    const reps = ids.map(id => q('SELECT * FROM users WHERE id = ?').get(id)).filter(Boolean).map(u => {
      const deals = q('SELECT * FROM customers WHERE owner_id = ?').all(u.id);
      const wonInRange = deals.filter(d => d.stage === 'Won' && (d.won_at || '') >= from && (d.won_at || '') <= to);
      const pays = q('SELECT p.* FROM payments p JOIN customers c ON c.id = p.customer_id WHERE c.owner_id = ? AND p.paid_on BETWEEN ? AND ?').all(u.id, from, to);
      const com = L.computeCommission(rules, wonInRange, pays);
      return { id: u.id, name: u.name, role: u.role, deals: deals.length, won: wonInRange.length, wonMrr: wonInRange.reduce((s, d) => s + d.seats * L.PRICE_PER_SEAT, 0),
        open: deals.filter(d => !['Won', 'Lost'].includes(d.stage)).length, ...com };
    });
    res.json({ reps, rules });
  });
  app.get('/api/slack/outbox', owner, (req, res) => res.json(q('SELECT * FROM slack_outbox ORDER BY id DESC LIMIT 50').all()));

  // ---- knowledge (Coach) ----
  app.get('/api/knowledge', page('coach'), (req, res) => res.json({ competitors, ...kb }));
  app.get('/api/knowledge/search', page('coach'), (req, res) => res.json(wave.searchKnowledge(req.query.q)));

  // ---- Wave ----
  app.get('/api/wave/status', (req, res) => res.json({ connected: wave.aiConfigured(env), model: env.WAVE_MODEL || 'gpt-4o-mini', voice: env.WAVE_VOICE || 'shimmer' }));
  app.post('/api/wave/chat', wrap(async (req, res) => {
    if (!wave.aiConfigured(env)) return res.status(503).json({ error: 'AI not connected', setup: 'Set OPENAI_API_KEY in .env and restart the server to connect Wave.' });
    const listCustomers = () => scoped(req.user).map(c => ({ id: c.id, business: c.business, stage: c.stage, seats: c.seats, provider: c.current_provider, monthly: c.current_monthly, next_step: c.next_step, next_step_date: c.next_step_date, contract_end: c.contract_end }));
    const args = { messages: (req.body || {}).messages || [], user: req.user, page: (req.body || {}).page || 'today', listCustomers, env };
    if (!(req.body || {}).stream) return res.json(await wave.chat(args));
    // Server-sent events: {t:'delta',v}, {t:'action',v}, {t:'done',reply}, {t:'error',v}
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    try { const out = await wave.chat({ ...args, onDelta: (v) => send({ t: 'delta', v }), onAction: (v) => send({ t: 'action', v }) }); send({ t: 'done', reply: out.reply }); }
    catch (e) { send({ t: 'error', v: e.message }); }
    res.end();
  }));
  app.post('/api/wave/tts', wrap(async (req, res) => {
    if (!wave.aiConfigured(env)) return res.status(503).json({ error: 'AI not connected' });
    const audio = await wave.tts((req.body || {}).text || '', { env });
    res.set('Content-Type', 'audio/mpeg').send(audio);
  }));

  // ---- settings (Owner) ----
  app.get('/api/users', (req, res) => {
    if (req.user.role === 'salesperson') return res.json([publicUser(req.user)]);
    const ids = visibleRepIds(req.user);
    res.json(q('SELECT * FROM users ORDER BY role, name').all().filter(u => ids.includes(u.id)).map(publicUser));
  });
  app.post('/api/users', owner, wrap(async (req, res) => {
    const { email, name, role, manager_id, password } = req.body || {};
    if (!email || !name || !L.ROLES.includes(role)) return bad(res, 400, 'Name, email and a valid tier are required.');
    if (!password || String(password).length < 8) return bad(res, 400, 'Password must be at least 8 characters.');
    try {
      const id = q('INSERT INTO users (email, name, role, manager_id, password_hash, is_test) VALUES (?,?,?,?,?,?)').run(String(email).trim(), name, role, manager_id || null, bcrypt.hashSync(String(password), 10), req.body.is_test ? 1 : 0).lastInsertRowid;
      audit(req.user.id, 'user.create', { id }); res.status(201).json(publicUser(q('SELECT * FROM users WHERE id = ?').get(id)));
    } catch (e) { bad(res, 409, 'That email is already in use.'); }
  }));
  app.put('/api/users/:id', owner, (req, res) => {
    const u = q('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)); if (!u) return bad(res, 404, 'Not found.');
    const b = req.body || {};
    if (b.role && !L.ROLES.includes(b.role)) return bad(res, 400, 'Unknown tier.');
    if (u.id === req.user.id && ((b.role && b.role !== 'owner') || b.active === false)) return bad(res, 400, 'You can\'t demote or deactivate yourself.');
    const set = {}; for (const k of ['name', 'role', 'manager_id']) if (b[k] !== undefined) set[k] = b[k] === '' ? null : b[k];
    if (b.active !== undefined) set.active = b.active ? 1 : 0;
    if (b.password) { if (String(b.password).length < 8) return bad(res, 400, 'Password must be at least 8 characters.'); set.password_hash = bcrypt.hashSync(String(b.password), 10); }
    const keys = Object.keys(set);
    if (keys.length) q(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => set[k]), u.id);
    if (set.active === 0 || set.password_hash) q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(req.user.id, 'user.update', { id: u.id, fields: keys.filter(k => k !== 'password_hash') });
    res.json(publicUser(q('SELECT * FROM users WHERE id = ?').get(u.id)));
  });
  app.get('/api/settings', owner, (req, res) => res.json({ tier_access: getSetting(db, 'tier_access'), commission_rules: getSetting(db, 'commission_rules'), slack: getSetting(db, 'slack'),
    env: { ai: wave.aiConfigured(env), slackToken: Boolean(env.SLACK_WEBHOOK_URL || env.SLACK_BOT_TOKEN), slackLive: env.SLACK_LIVE === 'true' } }));
  app.put('/api/settings/:key', owner, (req, res) => {
    const key = req.params.key; if (!['tier_access', 'commission_rules', 'slack'].includes(key)) return bad(res, 404, 'Unknown setting.');
    const v = req.body;
    if (key === 'commission_rules') {
      if (!(Number(v.base_pct) >= 0 && Number(v.base_pct) <= 100)) return bad(res, 400, 'Base commission must be 0–100%.');
      for (const s of v.spiffs || []) if (!s.name || !['pct_of_mrr', 'flat'].includes(s.type) || !(Number(s.value) >= 0)) return bad(res, 400, 'Each spiff needs a name, type and value.');
    }
    setSetting(db, key, v); audit(req.user.id, 'settings.update', { key }); res.json(v);
  });
  app.post('/api/slack/test', owner, wrap(async (req, res) => res.json(await slack.notify(db, 'test', { text: 'Test message from WaveLine Sales Hub' }, { env }))));

  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  return app;
}
module.exports = { createApp };
