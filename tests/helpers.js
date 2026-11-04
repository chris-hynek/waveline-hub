const { open, seed } = require('../src/db');
const { createApp } = require('../src/app');
async function startServer(env = {}) {
  const db = open(':memory:'); const ids = seed(db);
  const server = createApp(db, { env }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, ids, server, base, close: () => new Promise(r => server.close(r)) };
}
async function login(base, email, password = 'TestPass!2026') {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const call = async (path, opts = {}) => { const res = await fetch(base + '/api' + path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', cookie }, body: opts.body ? JSON.stringify(opts.body) : undefined }); let data = null; try { data = await res.json(); } catch {} return { status: res.status, data }; };
  return { status: r.status, cookie, call };
}
const EMAILS = { owner: 'owner@test.waveline.local', manager: 'manager@test.waveline.local', rep: 'rep@test.waveline.local', rep2: 'rep2@test.waveline.local' };
module.exports = { startServer, login, EMAILS };
