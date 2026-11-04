const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { DEFAULT_TIER_ACCESS } = require('./logic');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
    manager_id INTEGER REFERENCES users(id), password_hash TEXT NOT NULL, active INTEGER DEFAULT 1, is_test INTEGER DEFAULT 0,
    voice_consent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, business TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, industry TEXT,
    stage TEXT DEFAULT 'Lead', seats INTEGER DEFAULT 1, current_provider TEXT, current_monthly REAL, contract_end TEXT, next_step TEXT, next_step_date TEXT,
    owner_id INTEGER REFERENCES users(id), is_test INTEGER DEFAULT 0, won_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, user_id INTEGER, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, user_id INTEGER, amount REAL NOT NULL, paid_on TEXT NOT NULL, memo TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS quotes (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE, user_id INTEGER, data TEXT NOT NULL, monthly_savings REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS slack_outbox (id INTEGER PRIMARY KEY, event TEXT, channel TEXT, text TEXT, status TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const defaults = {
    tier_access: DEFAULT_TIER_ACCESS,
    commission_rules: { base_pct: 10, spiffs: [
      { id: 'switch', name: 'Competitor switch', type: 'pct_of_mrr', value: 25, from_competitor: true, active: true },
      { id: 'big', name: '10+ seat deal', type: 'flat', value: 150, min_seats: 10, active: true } ] },
    slack: { enabled: false, channels: { deals: '#sales-wins', payments: '#finance', spiffs: '#spiffs' }, events: { deal_won: true, payment: true, spiff: true } },
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, JSON.stringify(v));
  return db;
}

function getSetting(db, key) { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? JSON.parse(r.value) : null; }
function setSetting(db, key, value) { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); }

/** Seed clearly-labelled TEST data. Password for every test user: printed in README. */
function seed(db, password = 'TestPass!2026') {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return false;
  const h = bcrypt.hashSync(password, 10);
  const u = db.prepare('INSERT INTO users (email, name, role, manager_id, password_hash, is_test) VALUES (?, ?, ?, ?, ?, 1)');
  const owner = u.run('owner@test.waveline.local', 'Olivia Owner (TEST)', 'owner', null, h).lastInsertRowid;
  const mgr = u.run('manager@test.waveline.local', 'Marco Manager (TEST)', 'sales_manager', null, h).lastInsertRowid;
  const rep = u.run('rep@test.waveline.local', 'Riley Rep (TEST)', 'salesperson', mgr, h).lastInsertRowid;
  const rep2 = u.run('rep2@test.waveline.local', 'Sam Seller (TEST)', 'salesperson', null, h).lastInsertRowid;
  const c = db.prepare(`INSERT INTO customers (business, contact, phone, email, industry, stage, seats, current_provider, current_monthly, contract_end, next_step, next_step_date, owner_id, is_test, won_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const today = new Date(); const d = (n) => new Date(today.getTime() + n * 864e5).toISOString().slice(0, 10);
  const rows = [
    ['[TEST] Joe\'s Diner', 'Joe Rivera', '555-0101', 'joe@example.test', 'Restaurants', 'Quoted', 4, 'Spectrum Business Voice', 260, d(40), 'Send savings one-pager', d(0), rep, null],
    ['[TEST] Brightline Plumbing', 'Dana Wu', '555-0102', 'dana@example.test', 'Trades', 'Won', 12, 'Grasshopper', 790, null, 'Kickoff port', d(2), rep, d(-5)],
    ['[TEST] Harbor Inn B&B', 'Priya Shah', '555-0103', 'priya@example.test', 'Hospitality', 'Negotiating', 6, 'Nextiva', 420, d(60), 'Contract-end reminder', d(1), mgr, null],
    ['[TEST] ByteFix IT', 'Lee Park', '555-0104', 'lee@example.test', 'IT services', 'Lead', 3, 'Quo', 99, null, 'First call', d(0), rep2, null],
    ['[TEST] Summit Roofing', 'Ana Gomez', '555-0105', 'ana@example.test', 'Trades', 'Contacted', 8, 'RingCentral', 360, null, 'Get last bill', d(3), rep2, null],
    ['[TEST] Taco Town', 'Luis Ortega', '555-0106', 'luis@example.test', 'Restaurants', 'Won', 3, 'Comcast Business VoiceEdge', 210, null, 'Check in after 30 days', d(20), mgr, d(-12)],
  ];
  const ids = rows.map(r => c.run(...r).lastInsertRowid);
  const n = db.prepare('INSERT INTO notes (customer_id, user_id, body) VALUES (?,?,?)');
  n.run(ids[0], rep, 'TEST NOTE: Promo ends next month, price jumps to $50/line.');
  n.run(ids[1], rep, 'TEST NOTE: Signed! Wants porting done before spring rush.');
  const p = db.prepare('INSERT INTO payments (customer_id, user_id, amount, paid_on, memo) VALUES (?,?,?,?,?)');
  p.run(ids[1], rep, 600, d(-4), 'TEST payment: first month');
  p.run(ids[5], mgr, 150, d(-10), 'TEST payment: first month');
  return { owner, mgr, rep, rep2 };
}

module.exports = { open, seed, getSetting, setSetting };
