/* WaveLine Sales Hub - vanilla JS SPA */
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 });
const ROLE = { owner: 'Owner', sales_manager: 'Sales manager', salesperson: 'Salesperson' };
const NAV = [['today', 'Today', '☀'], ['customers', 'Customers', '◎'], ['quotes', 'Quotes', '≋'], ['coach', 'Coach', '✦'], ['reports', 'Reports', '▤'], ['settings', 'Settings', '⚙']];
const S = { me: null, waveOpen: localStorage.wl_wave !== '0', msgs: JSON.parse(sessionStorage.wl_msgs || '[]'), view: localStorage.wl_view || 'board', pendingFill: null };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (r.status === 401 && path !== '/login') { S.me = null; renderLogin(); throw new Error('Please sign in.'); }
  if (!r.ok) { const e = new Error(data?.error || 'Something went wrong.'); e.status = r.status; e.data = data; throw e; }
  return data;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2600); }
const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- login ----------
function renderLogin() {
  $('#app').innerHTML = `<div class="login"><form class="card" id="login-form" novalidate>
    <h1>WaveLine <span style="color:var(--accent)">Sales Hub</span></h1><p class="muted">Sign in with your own work email.</p>
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
    <div class="err" id="login-err"></div><button class="btn primary" style="width:100%">Sign in</button></form></div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    if (!d.email || !d.password) { $('#login-err').textContent = 'Enter your email and password.'; return; }
    try { await api('/login', { method: 'POST', body: d }); await boot(); } catch (err) { $('#login-err').textContent = err.message; }
  };
}

// ---------- shell ----------
async function boot() {
  try { S.me = await api('/me'); } catch { return renderLogin(); }
  $('#app').innerHTML = `<div class="shell"><nav class="side"><div class="brand">Wave<span>Line</span></div>
    ${NAV.filter(([k]) => S.me.pages.includes(k)).map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}"><span>${i}</span>${l}</a>`).join('')}
    <div class="spacer"></div><div class="who">${esc(S.me.user.name)}<br><span class="pill role" data-testid="role-pill">${ROLE[S.me.user.role]}</span></div>
    <a href="#" id="logout">Sign out</a></nav>
    <main id="main"></main>${waveShell()}</div>`;
  $('#logout').onclick = async (e) => { e.preventDefault(); await api('/logout', { method: 'POST' }); S.me = null; sessionStorage.clear(); renderLogin(); };
  bindWave(); route();
}
window.addEventListener('hashchange', () => { closeDrawer(); S.me && route(); });
function topbar(title, sub, actions = '') {
  return `<div class="top"><div class="grow"><h1>${title}</h1>${sub ? `<div class="muted">${sub}</div>` : ''}</div>${actions}
  <button class="btn" id="wave-toggle" title="Open Wave">✦ Wave</button></div>`;
}
async function route() {
  const [, page = 'today', id] = location.hash.split('/');
  const p = S.me.pages.includes(page) ? page : 'today';
  $$('nav.side a[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === p));
  const main = $('#main'); main.innerHTML = '<div class="muted">Loading…</div>';
  try { await PAGES[p](main, id); } catch (e) { if (e.status !== 401) main.innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  const t = $('#wave-toggle'); if (t) t.onclick = () => setWave(!S.waveOpen);
  if (S.pendingFill) { const f = S.pendingFill; S.pendingFill = null; applyFill(f); }
}

// ---------- Today ----------
const PAGES = {};
PAGES.today = async (el) => {
  const t = await api('/today'); const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const n = t.next;
  el.innerHTML = topbar(`${greet}, ${esc(S.me.user.name.split(' ')[0])}.`, 'Here is the one thing that moves money today.') + `
  <div class="card hero" data-testid="next-action"><div class="muted">Next best move</div>
    ${n ? `<div class="big">${esc(n.next_step || 'Follow up')} · ${esc(n.business)}</div><p class="muted">${esc(n.stage)} · ${n.seats} seats · ${esc(n.current_provider || 'provider unknown')}${n.next_step_date ? ' · due ' + esc(n.next_step_date) : ''}</p>
    <button class="btn primary" data-open="${n.id}">Open customer</button> <button class="btn" data-ask="Prep me for my next step with ${esc(n.business)}. What should I say?">Prep with Wave</button>`
    : `<div class="big">Your pipeline is empty.</div><p class="muted">Add your first prospect and Wave will plan the rest.</p><a class="btn primary" href="#/customers">Add a prospect</a>`}</div>
  <div class="tiles"><div class="tile"><div class="v">${t.stats.open}</div><div class="k">Open deals</div></div><div class="tile"><div class="v">${money(t.stats.pipelineMrr)}</div><div class="k">Pipeline / mo</div></div>
  <div class="tile"><div class="v">${t.stats.won}</div><div class="k">Won</div></div><div class="tile"><div class="v">${money(t.stats.wonMrr)}</div><div class="k">Won / mo</div></div></div>
  <div class="grid2"><div class="card"><h2>Due today</h2>${t.due.length ? t.due.map(c => `<div class="deal" data-open="${c.id}"><b>${esc(c.business)}</b><span class="muted">${esc(c.next_step || '')} · ${esc(c.next_step_date)}</span></div>`).join('') : '<p class="muted">Nothing overdue. Look at you.</p>'}</div>
  <div class="card"><h2>Contracts ending soon</h2>${t.contracts.length ? t.contracts.map(c => `<div class="deal" data-open="${c.id}"><b>${esc(c.business)}</b><span class="muted">${esc(c.current_provider || '')} ends in ${c.days} days</span></div>`).join('') : '<p class="muted">No contract deadlines in the next 60 days. Ask prospects: "When does your term end?"</p>'}</div></div>`;
  bindOpen(el);
};
function bindOpen(el) { $$('[data-open]', el).forEach(b => b.onclick = () => openCustomer(Number(b.dataset.open))); $$('[data-ask]', el).forEach(b => b.onclick = () => { setWave(true); sendWave(b.dataset.ask); }); }

// ---------- Customers ----------
let CUSTS = [], USERS = [];
PAGES.customers = async (el, id) => {
  [CUSTS, USERS] = await Promise.all([api('/customers'), api('/users')]);
  el.innerHTML = topbar('Customers', S.me.user.role === 'owner' ? 'Every customer on the team.' : S.me.user.role === 'sales_manager' ? 'You and your team.' : 'Your customers.',
    `<input class="search" id="cfilter" placeholder="Search customers" style="max-width:240px"><button class="btn" id="viewtoggle">${S.view === 'board' ? 'List view' : 'Board view'}</button><button class="btn primary" id="add-customer">Add prospect</button>`) + '<div id="cview"></div>';
  $('#add-customer').onclick = () => customerForm();
  $('#viewtoggle').onclick = () => { S.view = S.view === 'board' ? 'list' : 'board'; localStorage.wl_view = S.view; PAGES.customers(el); };
  $('#cfilter').oninput = () => drawCustomers();
  drawCustomers(); if (id) openCustomer(Number(id));
};
function drawCustomers() {
  const f = ($('#cfilter')?.value || '').toLowerCase(); const list = CUSTS.filter(c => !f || `${c.business} ${c.contact} ${c.industry} ${c.current_provider}`.toLowerCase().includes(f));
  const box = $('#cview'); if (!box) return;
  const tag = (c) => c.is_test ? ' <span class="pill test">TEST</span>' : '';
  if (S.view === 'list') {
    box.innerHTML = `<div class="card"><table data-testid="customer-list"><thead><tr><th>Business</th><th>Stage</th><th>Seats</th><th>Current provider</th><th>Owner</th><th>Next step</th></tr></thead><tbody>
    ${list.map(c => `<tr class="click" data-open="${c.id}"><td>${esc(c.business)}${tag(c)}</td><td>${esc(c.stage)}</td><td>${c.seats}</td><td>${esc(c.current_provider || '—')}</td><td>${esc(c.owner_name || '')}</td><td>${esc(c.next_step || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No customers yet.</td></tr>'}</tbody></table></div>`;
  } else {
    box.innerHTML = `<div class="board" data-testid="pipeline">${S.me.stages.map(st => { const cs = list.filter(c => c.stage === st);
      return `<div class="col" data-stage="${st}"><h3>${st}<span>${cs.length}</span></h3>${cs.map(c => `<div class="deal" draggable="true" data-id="${c.id}" data-open="${c.id}"><b>${esc(c.business)}</b><span class="muted">${c.seats} seats · ${money(c.seats * S.me.price)}/mo</span>${tag(c)}</div>`).join('')}</div>`; }).join('')}</div>`;
    $$('.deal[draggable]', box).forEach(d => d.ondragstart = (e) => e.dataTransfer.setData('text', d.dataset.id));
    $$('.col', box).forEach(col => { col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); }; col.ondragleave = () => col.classList.remove('drop');
      col.ondrop = async (e) => { e.preventDefault(); col.classList.remove('drop'); const id = Number(e.dataTransfer.getData('text'));
        try { await api('/customers/' + id, { method: 'PUT', body: { stage: col.dataset.stage } }); toast(col.dataset.stage === 'Won' ? '🎉 Deal won! Nice.' : 'Moved to ' + col.dataset.stage); CUSTS = await api('/customers'); drawCustomers(); } catch (err) { toast(err.message); } }; });
  }
  bindOpen(box);
}
function customerForm(c = {}) {
  const canAssign = S.me.user.role !== 'salesperson';
  openDrawer(`<h2>${c.id ? 'Edit customer' : 'Add prospect'}</h2>
  <form data-form="customer" id="customer-form">${c.id ? `<input type="hidden" name="id" value="${c.id}">` : ''}
  <div class="field"><label>Business name</label><input name="business" required value="${esc(c.business)}"></div>
  <div class="grid2"><div class="field"><label>Contact</label><input name="contact" value="${esc(c.contact)}"></div><div class="field"><label>Phone</label><input name="phone" value="${esc(c.phone)}"></div>
  <div class="field"><label>Email</label><input name="email" type="email" value="${esc(c.email)}"></div>
  <div class="field"><label>Industry</label><select name="industry">${['', 'Trades', 'IT services', 'Restaurants', 'Hospitality', 'Other'].map(i => `<option ${c.industry === i ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
  <div class="field"><label>Stage</label><select name="stage">${S.me.stages.map(s => `<option ${(c.stage || 'Lead') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  <div class="field"><label>Seats</label><input name="seats" type="number" min="1" value="${c.seats || 1}"></div>
  <div class="field"><label>Current provider</label><input name="current_provider" list="providers" value="${esc(c.current_provider)}"></div>
  <div class="field"><label>Current monthly bill ($)</label><input name="current_monthly" type="number" step="0.01" value="${c.current_monthly ?? ''}"></div>
  <div class="field"><label>Contract ends</label><input name="contract_end" type="date" value="${esc(c.contract_end)}"></div>
  ${canAssign ? `<div class="field"><label>Owner</label><select name="owner_id">${USERS.map(u => `<option value="${u.id}" ${(c.owner_id || S.me.user.id) === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}
  <div class="field"><label>Next step</label><input name="next_step" value="${esc(c.next_step)}"></div><div class="field"><label>Next step date</label><input name="next_step_date" type="date" value="${esc(c.next_step_date)}"></div></div>
  <label style="display:flex;gap:8px;align-items:center;margin-bottom:1em"><input type="checkbox" name="is_test" style="width:auto" ${c.is_test ? 'checked' : ''}> This is test data</label>
  <div class="err" id="cust-err"></div><button class="btn primary" type="submit">Save customer</button> <button class="btn" type="button" data-close>Cancel</button></form>
  <datalist id="providers">${['Quo (formerly OpenPhone)', 'Grasshopper', 'RingCentral', 'Dialpad', 'Nextiva', 'Ooma Office', 'Spectrum Business Voice', 'Comcast Business VoiceEdge', 'Vonage', 'Zoom Phone', 'Google Voice'].map(p => `<option value="${p}">`).join('')}</datalist>`);
  $('#customer-form').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); d.is_test = !!e.target.is_test.checked;
    try { const saved = await api('/customers' + (d.id ? '/' + d.id : ''), { method: d.id ? 'PUT' : 'POST', body: d }); closeDrawer(); toast('Saved ' + saved.business);
      if (location.hash.startsWith('#/customers')) { CUSTS = await api('/customers'); drawCustomers(); } } catch (err) { $('#cust-err').textContent = err.message; } };
}
async function openCustomer(id) {
  if (!USERS.length) USERS = await api('/users');
  const c = await api('/customers/' + id);
  openDrawer(`<div style="display:flex;justify-content:space-between;align-items:start"><div><h2>${esc(c.business)} ${c.is_test ? '<span class="pill test">TEST</span>' : ''}</h2>
    <div class="muted">${esc(c.contact || '')} ${c.phone ? '· ' + esc(c.phone) : ''} ${c.email ? '· ' + esc(c.email) : ''}</div></div><button class="btn ghost" data-close>✕</button></div>
  <div class="tiles" style="grid-template-columns:repeat(3,1fr);margin-top:16px"><div class="tile"><div class="v">${esc(c.stage)}</div><div class="k">Stage</div></div><div class="tile"><div class="v">${c.seats}</div><div class="k">Seats</div></div><div class="tile"><div class="v">${money(c.seats * S.me.price)}</div><div class="k">WaveLine / mo</div></div></div>
  <p><b>Current:</b> ${esc(c.current_provider || 'unknown')} ${c.current_monthly ? '· ' + money(c.current_monthly) + '/mo' : ''} ${c.contract_end ? '· contract ends ' + esc(c.contract_end) : ''}<br><b>Next:</b> ${esc(c.next_step || '—')} ${c.next_step_date ? '(' + esc(c.next_step_date) + ')' : ''} · <b>Owner:</b> ${esc(c.owner_name || '')}</p>
  <button class="btn" id="edit-c">Edit</button> <a class="btn" href="#/quotes/${c.id}" data-close>New quote</a> <button class="btn" data-ask="Coach me on ${esc(c.business)}: they're on ${esc(c.current_provider || 'an unknown provider')} with ${c.seats} seats, stage ${esc(c.stage)}. What's my play?">Ask Wave</button>
  ${S.me.user.role !== 'salesperson' ? '<button class="btn ghost" id="del-c" style="color:#b42318">Delete</button>' : ''}
  <div class="card" style="margin-top:18px"><h3>Notes</h3><form data-form="note" id="note-form" style="display:flex;gap:8px"><input type="hidden" name="customer_id" value="${c.id}"><input name="body" placeholder="Add a note"><button class="btn primary">Save note</button></form>
  ${c.notes.map(n => `<p><span class="muted">${esc(n.created_at.slice(0, 10))} · ${esc(n.author || '')}</span><br>${esc(n.body)}</p>`).join('')}</div>
  <div class="card"><h3>Payments</h3><form data-form="payment" id="payment-form" class="grid3"><input type="hidden" name="customer_id" value="${c.id}"><input name="amount" type="number" step="0.01" placeholder="Amount"><input name="paid_on" type="date" value="${new Date().toISOString().slice(0, 10)}"><input name="memo" placeholder="Memo"><button class="btn primary">Log payment</button></form>
  <table style="margin-top:10px">${c.payments.map(p => `<tr><td>${esc(p.paid_on)}</td><td>${money(p.amount)}</td><td class="muted">${esc(p.memo || '')}</td></tr>`).join('') || '<tr><td class="muted">No payments yet.</td></tr>'}</table></div>
  <div class="card"><h3>Quotes</h3>${c.quotes.map(q => `<p>${esc(q.created_at.slice(0, 10))}: saves <b>${money(q.data.monthlySavings)}/mo</b> vs ${esc(q.data.provider)}</p>`).join('') || '<p class="muted">No quotes yet.</p>'}</div>`);
  $('#edit-c').onclick = () => customerForm(c);
  if ($('#del-c')) $('#del-c').onclick = async () => { if (!confirm('Delete ' + c.business + '? This cannot be undone.')) return; await api('/customers/' + c.id, { method: 'DELETE' }); closeDrawer(); toast('Deleted'); route(); };
  $('#note-form').onsubmit = async (e) => { e.preventDefault(); try { await api(`/customers/${c.id}/notes`, { method: 'POST', body: formData(e.target) }); toast('Note saved'); openCustomer(c.id); } catch (err) { toast(err.message); } };
  $('#payment-form').onsubmit = async (e) => { e.preventDefault(); try { await api(`/customers/${c.id}/payments`, { method: 'POST', body: formData(e.target) }); toast('Payment logged'); openCustomer(c.id); } catch (err) { toast(err.message); } };
  bindOpen($('.drawer'));
}
function openDrawer(html) { closeDrawer(); const d = document.createElement('div'); d.className = 'drawer'; d.innerHTML = `<div class="panel">${html}</div>`; d.onclick = (e) => { if (e.target === d || e.target.closest('[data-close]')) closeDrawer(); }; document.body.appendChild(d); }
function closeDrawer() { $$('.drawer').forEach(d => d.remove()); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// ---------- Quotes ----------
let QS = null;
PAGES.quotes = async (el, id) => {
  const custs = await api('/customers');
  QS = { step: 1, customer_id: id ? Number(id) : '', provider: '', seats: 1, lines: [{ label: 'Monthly service', amount: '' }], result: null };
  if (id) { const c = custs.find(x => x.id === Number(id)); if (c) Object.assign(QS, { provider: c.current_provider || '', seats: c.seats }); }
  el.innerHTML = topbar('Quotes', 'Compare their bill to WaveLine in three steps.') + `<div class="steps"><div class="step" data-s="1">1 · Customer</div><div class="step" data-s="2">2 · Current bill</div><div class="step" data-s="3">3 · Savings</div></div>
  <form data-form="quote" id="quote-form" class="card"><div id="qbody"></div></form>`;
  const draw = () => {
    $$('.step').forEach(s => s.classList.toggle('on', Number(s.dataset.s) === QS.step));
    const b = $('#qbody');
    if (QS.step === 1) b.innerHTML = `<div class="field"><label>Customer</label><select name="customer_id"><option value="">Choose a customer…</option>${custs.map(c => `<option value="${c.id}" ${QS.customer_id === c.id ? 'selected' : ''}>${esc(c.business)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label>Current provider</label><input name="provider" list="qproviders" value="${esc(QS.provider)}"></div><div class="field"><label>Seats (people who need a line)</label><input name="seats" type="number" min="1" value="${QS.seats}"></div></div>
      <datalist id="qproviders">${['Quo (formerly OpenPhone)', 'Grasshopper', 'RingCentral', 'Dialpad', 'Nextiva', 'Ooma Office', 'Spectrum Business Voice', 'Comcast Business VoiceEdge', 'Vonage'].map(p => `<option value="${p}">`).join('')}</datalist>
      <p class="muted">Not in the list? <a href="#/customers">Add a prospect</a> first.</p><div class="err" id="qerr"></div><button class="btn primary" type="button" id="qnext">Next: enter their bill</button>`;
    if (QS.step === 2) b.innerHTML = `<p class="muted">Copy each charge from their latest bill: service, extra numbers, extensions, equipment, taxes and "recovery" fees.</p><div id="qlines">${QS.lines.map((l, i) => `<div class="grid3" style="grid-template-columns:2fr 1fr auto;margin-bottom:8px"><input name="label_${i}" value="${esc(l.label)}" placeholder="Charge"><input name="amount_${i}" type="number" step="0.01" value="${esc(l.amount)}" placeholder="$"><button class="btn ghost" type="button" data-rm="${i}">✕</button></div>`).join('')}</div>
      <button class="btn sm" type="button" id="qadd">+ Add charge</button><p class="consent" style="margin-top:14px">Privacy: bills you enter stay inside the hub. If you ask Wave to analyze a bill, its contents are sent to the connected AI provider.</p>
      <button class="btn" type="button" id="qback">Back</button> <button class="btn primary" type="button" id="qcalc">See savings</button>`;
    if (QS.step === 3) { const r = QS.result; b.innerHTML = `<div class="grid2"><div><div class="muted">${r.saves ? 'They save' : 'Difference'}</div><div class="savings ${r.saves ? '' : 'neg'}" data-testid="savings">${money(r.monthlySavings)}/mo</div><div class="big">${money(r.annualSavings)} a year</div></div>
      <table><tr><td>${esc(r.provider)} today</td><td>${money(r.currentMonthly)} (${money(r.currentPerSeat)}/seat)</td></tr><tr><td>WaveLine, ${r.seats} seats × ${money(S.me.price)}</td><td>${money(r.wavelineMonthly)}</td></tr><tr><td>Savings</td><td><b>${r.savingsPct}%</b></td></tr></table></div>
      ${r.saves ? '' : '<p class="consent">WaveLine costs more on paper here. Sell the value: shared lines, texting, transfers and IVR in every seat, month-to-month, easy exit.</p>'}
      <button class="btn" type="button" id="qback">Edit bill</button> <button class="btn primary" type="button" id="qsave">Save quote to customer</button> <button class="btn" type="button" data-ask="Write me a 3-line pitch for this quote: ${esc(r.provider)}, ${r.seats} seats, ${money(r.currentMonthly)} now vs ${money(r.wavelineMonthly)} on WaveLine.">Pitch it with Wave</button>`; bindOpen(b); }
    const g = (id) => $('#' + id, b);
    if (g('qnext')) g('qnext').onclick = () => { readQ(); if (!QS.customer_id) { $('#qerr').textContent = 'Choose a customer first.'; return; } QS.step = 2; draw(); };
    if (g('qadd')) g('qadd').onclick = () => { readQ(); QS.lines.push({ label: '', amount: '' }); draw(); };
    $$('[data-rm]', b).forEach(x => x.onclick = () => { readQ(); QS.lines.splice(Number(x.dataset.rm), 1); draw(); });
    if (g('qback')) g('qback').onclick = () => { readQ(); QS.step--; draw(); };
    if (g('qcalc')) g('qcalc').onclick = async () => { readQ(); QS.result = await api('/quotes/preview', { method: 'POST', body: QS }); QS.step = 3; draw(); };
    if (g('qsave')) g('qsave').onclick = async () => { try { await api('/quotes', { method: 'POST', body: QS }); toast('Quote saved to customer'); location.hash = '#/customers/' + QS.customer_id; } catch (e) { toast(e.message); } };
  };
  QS.draw = draw; draw();
};
function readQ() { const f = $('#quote-form'); if (!f) return; const d = formData(f);
  if ('customer_id' in d) { QS.customer_id = d.customer_id ? Number(d.customer_id) : ''; QS.provider = d.provider; QS.seats = Number(d.seats) || 1; }
  if ('label_0' in d || QS.step === 2) QS.lines = QS.lines.map((l, i) => ({ label: d['label_' + i] ?? l.label, amount: d['amount_' + i] ?? l.amount })); }

// ---------- Coach ----------
PAGES.coach = async (el) => {
  const k = await api('/knowledge'); const tab = sessionStorage.wl_ctab || 'battlecards';
  el.innerHTML = topbar('Coach', 'Ask Wave anything, or browse the playbook.') + `
  <div class="card hero"><div style="display:flex;gap:14px;align-items:center"><div class="orb"></div><div><h2 style="color:#fff;margin:0">Wave is your sales coach.</h2><div class="muted">Battlecards on ${k.competitors.length} competitors, objection handling, scripts by industry and role-play.</div></div></div>
  <div class="chips" style="padding:14px 0 0">${['Give me the restaurant cold-call script', 'How do I beat Quo?', 'Role-play a skeptical plumber with me', 'Marketing idea of the week', 'Plan my day'].map(q => `<button class="chip" data-ask="${q}">${q}</button>`).join('')}</div></div>
  <input id="kq" placeholder="Search the playbook (e.g. Nextiva contract, porting, restaurant)" style="margin-bottom:14px">
  <div class="tabs">${[['battlecards', 'Battlecards'], ['objections', 'Objections'], ['scripts', 'Scripts'], ['plays', 'Winning plays'], ['practice', 'Practice']].map(([key, l]) => `<button data-tab="${key}" class="${tab === key ? 'on' : ''}">${l}</button>`).join('')}</div><div id="kbody"></div>`;
  const draw = (t, f = '') => { sessionStorage.wl_ctab = t; $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); const m = (s) => !f || s.toLowerCase().includes(f.toLowerCase());
    const body = $('#kbody');
    if (t === 'battlecards') body.innerHTML = `<div class="kb">${k.competitors.filter(c => m(JSON.stringify(c))).map(c => `<details class="bc"><summary>${esc(c.n)} <span class="pill">${esc(c.g)}</span></summary>
      <p><b>How to win:</b> ${esc(c.win)}</p><p><b>Pricing:</b> ${esc(c.price)}</p><p><b>Weak spots:</b> ${esc(c.minus)}</p><p><b>Strengths:</b> ${esc(c.plus)}</p><p><b>Leadership:</b> ${esc(c.lead)}</p><p><b>Money:</b> ${esc(c.money)}</p><p><b>Legal:</b> ${esc(c.legal)}</p>
      <p class="muted">${c.src.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>`).join(' · ')}</p></details>`).join('')}</div>`;
    if (t === 'objections') body.innerHTML = k.objections.filter(o => m(o.q + o.a)).map(o => `<div class="card"><h3>“${esc(o.q)}”</h3><p>${esc(o.a)}</p></div>`).join('');
    if (t === 'scripts') body.innerHTML = k.scripts.filter(s => m(s.industry + s.title + s.body)).map(s => `<div class="card"><span class="pill">${esc(s.industry)}</span><h3 style="margin-top:8px">${esc(s.title)}</h3><p>${esc(s.body)}</p></div>`).join('');
    if (t === 'plays') body.innerHTML = k.plays.filter(p => m(p.title + p.detail)).map(p => `<div class="card"><h3>${esc(p.title)}</h3><p>${esc(p.detail)}</p></div>`).join('');
    if (t === 'practice') body.innerHTML = `<div class="kb">${k.practice.map(p => `<div class="card"><h3>${esc(p.title)}</h3><p class="muted">${esc(p.setup)}</p><button class="btn primary" data-ask="Role-play time. You are: ${esc(p.setup)} I'm the WaveLine rep. Stay in character, push back realistically, then score me out of 10 when I say 'score me'.">Start role-play</button></div>`).join('')}</div>`;
    bindOpen(body); };
  $$('.tabs button').forEach(b => b.onclick = () => draw(b.dataset.tab, $('#kq').value));
  $('#kq').oninput = (e) => draw(sessionStorage.wl_ctab || 'battlecards', e.target.value);
  bindOpen(el); draw(tab);
};

// ---------- Reports ----------
PAGES.reports = async (el) => {
  const from = sessionStorage.wl_from || '', to = sessionStorage.wl_to || '';
  const r = await api(`/reports?${from ? 'from=' + from + '&' : ''}${to ? 'to=' + to : ''}`);
  const tot = (k) => r.reps.reduce((s, x) => s + (x[k] || 0), 0);
  el.innerHTML = topbar('Reports', r.reps.length > 1 ? 'Team performance and commissions.' : 'Your performance and commissions.',
    `<input type="date" id="rfrom" value="${from}" style="width:auto"><input type="date" id="rto" value="${to}" style="width:auto">`) + `
  <div class="tiles"><div class="tile"><div class="v">${tot('won')}</div><div class="k">Deals won</div></div><div class="tile"><div class="v">${money(tot('wonMrr'))}</div><div class="k">New MRR</div></div><div class="tile"><div class="v">${money(tot('collected'))}</div><div class="k">Collected</div></div><div class="tile"><div class="v">${money(tot('total'))}</div><div class="k">Commission + spiffs</div></div></div>
  <div class="card"><h2>By rep</h2><table data-testid="report-table"><thead><tr><th>Rep</th><th>Open</th><th>Won</th><th>New MRR</th><th>Collected</th><th>Base (${r.rules.base_pct}%)</th><th>Spiffs</th><th>Total</th></tr></thead><tbody>
  ${r.reps.map(x => `<tr><td>${esc(x.name)}<br><span class="muted" style="font-size:.8rem">${ROLE[x.role]}</span></td><td>${x.open}</td><td>${x.won}</td><td>${money(x.wonMrr)}</td><td>${money(x.collected)}</td><td>${money(x.base)}</td><td title="${esc(x.spiffLines.map(l => l.spiff + ' on ' + l.customer + ': ' + money(l.amount)).join('\n'))}">${money(x.spiffTotal)}</td><td><b>${money(x.total)}</b></td></tr>`).join('')}</tbody></table>
  <p class="muted" style="margin-top:10px">Active spiffs: ${r.rules.spiffs.filter(s => s.active !== false).map(s => `${esc(s.name)} (${s.type === 'flat' ? money(s.value) : s.value + '% of MRR'})`).join(', ') || 'none'}</p></div>
  <button class="btn" data-ask="Give me a quick business review from my Reports numbers: what's working, what's slipping, and one marketing move for this month.">Review with Wave</button>`;
  const upd = () => { sessionStorage.wl_from = $('#rfrom').value; sessionStorage.wl_to = $('#rto').value; PAGES.reports(el).then(() => { const t = $('#wave-toggle'); if (t) t.onclick = () => setWave(!S.waveOpen); }); };
  $('#rfrom').onchange = upd; $('#rto').onchange = upd; bindOpen(el);
};

// ---------- Settings (Owner) ----------
PAGES.settings = async (el) => {
  const [s, users, outbox] = await Promise.all([api('/settings'), api('/users'), api('/slack/outbox')]);
  const tab = sessionStorage.wl_stab || 'people';
  el.innerHTML = topbar('Settings', 'You control who sees what, and how people get paid.') + `<div class="tabs">${[['people', 'People & access'], ['tiers', 'What each tier sees'], ['pay', 'Commission & spiffs'], ['slack', 'Slack'], ['ai', 'Wave AI']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="sbody"></div>`;
  const draw = (t) => { sessionStorage.wl_stab = t; $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); const b = $('#sbody');
    if (t === 'people') { b.innerHTML = `<div class="card"><table data-testid="people"><thead><tr><th>Name</th><th>Email</th><th>Tier</th><th>Manager</th><th>Status</th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.name)} ${u.is_test ? '<span class="pill test">TEST</span>' : ''}</td><td>${esc(u.email)}</td>
      <td><select data-u="${u.id}" data-k="role" ${u.id === S.me.user.id ? 'disabled' : ''}>${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><select data-u="${u.id}" data-k="manager_id"><option value="">—</option>${users.filter(m => m.role === 'sales_manager').map(m => `<option value="${m.id}" ${u.manager_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></td>
      <td>${u.id === S.me.user.id ? 'You' : `<button class="btn sm" data-act="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'Deactivate' : 'Reactivate'}</button>`}</td></tr>`).join('')}</tbody></table></div>
      <form class="card" data-form="user" id="user-form"><h3>Add a teammate</h3><div class="grid2"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>Tier</label><select name="role">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${k === 'salesperson' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Manager</label><select name="manager_id"><option value="">—</option>${users.filter(m => m.role === 'sales_manager').map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Temporary password (8+ characters)</label><input name="password" type="password" autocomplete="new-password"></div></div><div class="err" id="uerr"></div><button class="btn primary">Add teammate</button></form>`;
      $$('select[data-u]', b).forEach(sel => sel.onchange = async () => { try { await api('/users/' + sel.dataset.u, { method: 'PUT', body: { [sel.dataset.k]: sel.value === '' ? null : (sel.dataset.k === 'manager_id' ? Number(sel.value) : sel.value) } }); toast('Updated'); } catch (e) { toast(e.message); } });
      $$('[data-act]', b).forEach(x => x.onclick = async () => { await api('/users/' + x.dataset.act, { method: 'PUT', body: { active: x.dataset.on === '1' } }); toast('Updated'); PAGES.settings(el); });
      $('#user-form').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); if (d.manager_id) d.manager_id = Number(d.manager_id); try { await api('/users', { method: 'POST', body: d }); toast('Teammate added'); PAGES.settings(el); } catch (err) { $('#uerr').textContent = err.message; } }; }
    if (t === 'tiers') { const ta = s.tier_access; const keys = [['today', 'Today'], ['customers', 'Customers'], ['quotes', 'Quotes'], ['coach', 'Coach'], ['reports', 'Reports'], ['team_reports', 'Team numbers in Reports']];
      b.innerHTML = `<div class="card"><table><thead><tr><th>Area</th><th>Sales manager</th><th>Salesperson</th></tr></thead><tbody>${keys.map(([k, l]) => `<tr><td>${l}</td>${['sales_manager', 'salesperson'].map(r => `<td><input type="checkbox" style="width:auto" data-r="${r}" data-k="${k}" ${ta[r][k] ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="muted">Settings is always Owner only. Managers see their own team's customers; salespeople see their own.</p><button class="btn primary" id="save-tiers">Save access</button></div>`;
      $('#save-tiers').onclick = async () => { $$('[data-r]', b).forEach(c => ta[c.dataset.r][c.dataset.k] = c.checked); await api('/settings/tier_access', { method: 'PUT', body: ta }); toast('Access saved'); }; }
    if (t === 'pay') { const cr = s.commission_rules;
      b.innerHTML = `<div class="card"><div class="field" style="max-width:260px"><label>Base commission (% of payments collected)</label><input id="basepct" type="number" min="0" max="100" step="0.5" value="${cr.base_pct}"></div>
      <h3>Spiffs</h3><table><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Min seats</th><th>Must switch from a competitor</th><th>Active</th><th></th></tr></thead><tbody id="spiffs">${cr.spiffs.map((sp, i) => `<tr data-i="${i}"><td><input data-f="name" value="${esc(sp.name)}"></td><td><select data-f="type"><option value="pct_of_mrr" ${sp.type === 'pct_of_mrr' ? 'selected' : ''}>% of first-month MRR</option><option value="flat" ${sp.type === 'flat' ? 'selected' : ''}>Flat $</option></select></td>
      <td><input data-f="value" type="number" step="0.5" value="${sp.value}"></td><td><input data-f="min_seats" type="number" value="${sp.min_seats || ''}"></td><td><input data-f="from_competitor" type="checkbox" style="width:auto" ${sp.from_competitor ? 'checked' : ''}></td><td><input data-f="active" type="checkbox" style="width:auto" ${sp.active !== false ? 'checked' : ''}></td><td><button class="btn ghost sm" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>
      <form data-form="spiff" id="spiff-form" class="grid3" style="margin-top:12px;grid-template-columns:2fr 1fr 1fr 1fr auto"><input name="name" placeholder="New spiff name"><select name="type"><option value="pct_of_mrr">% of MRR</option><option value="flat">Flat $</option></select><input name="value" type="number" step="0.5" placeholder="Value"><input name="min_seats" type="number" placeholder="Min seats"><button class="btn" type="submit">Add spiff</button></form>
      <div class="err" id="perr"></div><button class="btn primary" id="save-pay" style="margin-top:12px">Save commission rules</button></div>`;
      const collect = () => ({ base_pct: Number($('#basepct').value), spiffs: $$('#spiffs tr').map(tr => { const g = (f) => $(`[data-f="${f}"]`, tr); return { id: cr.spiffs[tr.dataset.i]?.id || 'sp' + Date.now() + tr.dataset.i, name: g('name').value, type: g('type').value, value: Number(g('value').value), min_seats: Number(g('min_seats').value) || null, from_competitor: g('from_competitor').checked, active: g('active').checked }; }) });
      $('#spiff-form').onsubmit = (e) => { e.preventDefault(); const d = formData(e.target); if (!d.name) return; const cur = collect(); cur.spiffs.push({ id: 'sp' + Date.now(), name: d.name, type: d.type, value: Number(d.value) || 0, min_seats: Number(d.min_seats) || null, from_competitor: false, active: true }); s.commission_rules = cur; draw('pay'); };
      $$('[data-del]', b).forEach(x => x.onclick = () => { const cur = collect(); cur.spiffs.splice(Number(x.dataset.del), 1); s.commission_rules = cur; draw('pay'); });
      $('#save-pay').onclick = async () => { try { s.commission_rules = await api('/settings/commission_rules', { method: 'PUT', body: collect() }); toast('Commission rules saved'); } catch (e) { $('#perr').textContent = e.message; } }; }
    if (t === 'slack') { const sl = s.slack;
      b.innerHTML = `<div class="card"><p>${s.env.slackToken ? '✅ Slack credentials found in the server environment.' : '⚪ No Slack credentials yet. Add SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN to .env.'} ${s.env.slackLive ? '<b>Live sending is ON.</b>' : 'Dry-run mode: messages are logged below, nothing is sent (set SLACK_LIVE=true to go live).'}</p>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sl-en" style="width:auto" ${sl.enabled ? 'checked' : ''}> Post updates to Slack</label>
      <div class="grid3" style="margin-top:12px">${[['deals', 'Deals won channel'], ['payments', 'Payments / finance channel'], ['spiffs', 'Spiffs channel']].map(([k, l]) => `<div class="field"><label>${l}</label><input data-ch="${k}" value="${esc(sl.channels[k])}"></div>`).join('')}</div>
      ${[['deal_won', 'Deal won'], ['payment', 'Payment logged'], ['spiff', 'Spiff earned']].map(([k, l]) => `<label style="display:inline-flex;gap:6px;margin-right:16px"><input type="checkbox" style="width:auto" data-ev="${k}" ${sl.events[k] !== false ? 'checked' : ''}>${l}</label>`).join('')}
      <div style="margin-top:14px"><button class="btn primary" id="save-slack">Save Slack settings</button> <button class="btn" id="test-slack">Send test (dry-run unless live)</button></div></div>
      <div class="card"><h3>Slack log</h3><table data-testid="slack-log">${outbox.map(o => `<tr><td class="muted">${esc(o.created_at)}</td><td>${esc(o.channel)}</td><td>${esc(o.text)}</td><td><span class="pill">${esc(o.status)}</span></td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>'}</table></div>`;
      $('#save-slack').onclick = async () => { sl.enabled = $('#sl-en').checked; $$('[data-ch]', b).forEach(i => sl.channels[i.dataset.ch] = i.value); $$('[data-ev]', b).forEach(i => sl.events[i.dataset.ev] = i.checked); await api('/settings/slack', { method: 'PUT', body: sl }); toast('Slack settings saved'); };
      $('#test-slack').onclick = async () => { const r = await api('/slack/test', { method: 'POST' }); toast('Test: ' + r.status); PAGES.settings(el); }; }
    if (t === 'ai') b.innerHTML = `<div class="card"><h3>${s.env.ai ? '✅ Wave is connected' : 'Connect Wave'}</h3>${s.env.ai ? '<p>Wave can chat, coach, navigate and fill forms. Voice uses the same key.</p>' : `<ol><li>Get an API key from your AI provider (OpenAI-compatible).</li><li>On the server, add <code>OPENAI_API_KEY=…</code> to <code>.env</code> (optional: <code>WAVE_MODEL</code>, <code>WAVE_VOICE</code>, <code>OPENAI_BASE_URL</code>).</li><li>Restart the hub.</li></ol>`}
      <p class="consent"><b>Recording & AI consent.</b> Wave never records customer calls. If you add call recording or AI call analysis later, every party must be told and consent first (California and other all-party-consent states). See Freund v. Dialpad (2026), where a suit over AI call analysis survived dismissal.</p></div>`;
  };
  $$('.tabs button').forEach(x => x.onclick = () => draw(x.dataset.tab)); draw(tab);
};

// ---------- Wave panel ----------
function waveShell() {
  return `<aside class="wave ${S.waveOpen ? '' : 'closed'}" id="wave" aria-label="Wave assistant"><div class="wave-head"><div class="orb" id="orb"></div><div style="flex:1"><b>Wave</b><div class="muted" style="font-size:.82rem" id="wave-status">${S.me.ai ? 'Your sales coach' : 'AI not connected'}</div></div>
  <button class="btn ghost sm" id="wave-speak" title="Read replies aloud">🔈</button><button class="btn ghost sm" id="wave-close" title="Close">✕</button></div>
  <div class="wave-log" id="wave-log"></div>
  <div class="chips" id="wave-chips">${['Plan my day', 'Add a prospect for me', 'Handle "we\'re under contract"'].map(c => `<button class="chip" data-ask="${c}">${c}</button>`).join('')}</div>
  <form class="wave-in" id="wave-form"><button class="btn" type="button" id="wave-mic" title="Talk to Wave">🎙</button><input id="wave-input" placeholder="Ask Wave or tell her what to do" autocomplete="off"><button class="btn primary">Send</button></form></aside>`;
}
function setWave(open) { S.waveOpen = open; localStorage.wl_wave = open ? '1' : '0'; $('#wave')?.classList.toggle('closed', !open); }
function drawLog() {
  const log = $('#wave-log'); if (!log) return;
  const intro = S.me.ai ? `<div class="msg a">Hey ${esc(S.me.user.name.split(' ')[0])}. I'm Wave. I can pull up scripts, prep calls, build quotes and fill out forms for you. You just hit Save. What are we closing today?</div>`
    : `<div class="msg sys" data-testid="connect-ai"><b>Connect AI to wake Wave up.</b><br>Wave needs an AI key on the server. Ask your Owner to add <code>OPENAI_API_KEY</code> to the hub's <code>.env</code> and restart.${S.me.user.role === 'owner' ? ' <a href="#/settings" onclick="sessionStorage.wl_stab=\'ai\'">Setup steps</a>' : ''}<br><br>Meanwhile the Coach page has every battlecard, script and objection.</div>`;
  log.innerHTML = intro + S.msgs.map(m => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${esc(m.content)}</div>`).join(''); log.scrollTop = log.scrollHeight;
}
function bindWave() {
  drawLog(); $('#wave-close').onclick = () => setWave(false);
  $('#wave-form').onsubmit = (e) => { e.preventDefault(); const v = $('#wave-input').value.trim(); if (v) { $('#wave-input').value = ''; sendWave(v); } };
  bindOpen($('#wave'));
  const sp = $('#wave-speak'); sp.style.opacity = localStorage.wl_speak === '1' ? 1 : .45; sp.onclick = () => { localStorage.wl_speak = localStorage.wl_speak === '1' ? '0' : '1'; sp.style.opacity = localStorage.wl_speak === '1' ? 1 : .45; };
  $('#wave-mic').onclick = startMic;
}
async function sendWave(text) {
  setWave(true);
  if (!S.me.ai) { drawLog(); $('#wave-log').insertAdjacentHTML('beforeend', `<div class="msg u">${esc(text)}</div><div class="msg sys">I'm not connected to an AI yet, so I can't answer for real. Add OPENAI_API_KEY on the server to turn me on.</div>`); return; }
  S.msgs.push({ role: 'user', content: text }); drawLog();
  const log = $('#wave-log'); log.insertAdjacentHTML('beforeend', '<div class="msg a muted" id="thinking">Thinking…</div>'); log.scrollTop = log.scrollHeight; $('#orb').classList.add('talk');
  try {
    const page = location.hash.split('/')[1] || 'today';
    const res = await fetch('/api/wave/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: S.msgs, page, stream: true }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Wave hit a snag.');
    const bubble = $('#thinking'); let reply = ''; const actions = []; const dec = new TextDecoder(); let buf = '';
    const reader = res.body.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (!line.startsWith('data: ')) continue; const ev = JSON.parse(line.slice(6));
        if (ev.t === 'delta') { reply += ev.v; if (bubble) { bubble.classList.remove('muted'); bubble.textContent = reply; log.scrollTop = log.scrollHeight; } }
        else if (ev.t === 'action') actions.push(ev.v);
        else if (ev.t === 'done') reply = ev.reply || reply;
        else if (ev.t === 'error') throw new Error(ev.v); } }
    S.msgs.push({ role: 'assistant', content: reply || '(done)' }); sessionStorage.wl_msgs = JSON.stringify(S.msgs.slice(-30)); drawLog();
    for (const a of actions) await runAction(a);
    if (localStorage.wl_speak === '1' && reply) speak(reply);
  } catch (e) { $('#thinking')?.remove(); log.insertAdjacentHTML('beforeend', `<div class="msg sys">${esc(e.message)}</div>`); }
  finally { $('#orb')?.classList.remove('talk'); }
}
async function runAction(a) {
  if (a.type === 'fill_form' && a.customer_id && !(a.fields || {}).customer_id && a.form === 'quote') a = { ...a, fields: { ...a.fields, customer_id: a.customer_id } };
  if (a.type === 'navigate') { const target = '#/' + a.page + (a.customer_id ? '/' + a.customer_id : ''); if (location.hash !== target) { location.hash = target; await new Promise(r => setTimeout(r, 350)); } return; }
  if (a.type === 'fill_form') {
    const want = { customer: 'customers', note: 'customers', payment: 'customers', quote: 'quotes', user: 'settings', spiff: 'settings' }[a.form];
    const cur = location.hash.split('/')[1];
    if (a.form === 'quote' && (cur !== 'quotes' || a.fields?.customer_id)) { S.pendingFill = a; location.hash = '#/quotes' + (a.fields?.customer_id ? '/' + a.fields.customer_id : ''); return; }
    if (cur !== want) { S.pendingFill = a; if (want === 'settings') sessionStorage.wl_stab = a.form === 'user' ? 'people' : 'pay'; location.hash = '#/' + want; return; }
    applyFill(a);
  }
}
async function applyFill(a) {
  const f = a.fields || {};
  if (a.form === 'customer') { if (f.id) { const c = await api('/customers/' + f.id); customerForm(c); } else if (!$('#customer-form')) customerForm(); }
  if ((a.form === 'note' || a.form === 'payment') && (a.customer_id || f.customer_id)) { await openCustomer(Number(a.customer_id || f.customer_id)); }
  if (a.form === 'quote' && QS) { Object.assign(QS, { customer_id: f.customer_id ? Number(f.customer_id) : QS.customer_id, provider: f.provider ?? QS.provider, seats: f.seats ?? QS.seats });
    if (Array.isArray(f.lines) && f.lines.length) { QS.lines = f.lines; QS.step = 2; } QS.draw(); $$('#quote-form input, #quote-form select').forEach(i => { i.classList.remove('filled'); void i.offsetWidth; i.classList.add('filled'); }); toast('Wave filled the quote. Review, then continue.'); return; }
  const form = $(`[data-form="${a.form}"]`); if (!form) return toast('Wave could not find that form.');
  for (const [k, v] of Object.entries(f)) { const i = form.querySelector(`[name="${k}"]`); if (!i || i.type === 'hidden') continue;
    if (i.type === 'checkbox') i.checked = !!v; else i.value = v ?? ''; i.classList.remove('filled'); void i.offsetWidth; i.classList.add('filled'); await new Promise(r => setTimeout(r, 120)); }
  form.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Wave filled this in. Check it, then press Save.');
}
// Voice: browser speech recognition in, server TTS out (same AI key).
let rec = null;
function startMic() {
  if (!S.me.ai) return sendWave('(voice)');
  if (!S.me.user.voice_consent) {
    openDrawer(`<h2>Before you talk to Wave</h2><div class="consent"><p>Wave only listens while the mic button is on. Your speech is transcribed by your browser and the text is sent to the connected AI provider to answer you.</p>
    <p><b>Don't use Wave's mic during a customer call</b> unless everyone on the call has been told and agreed. Many states require all-party consent for recording or AI analysis of calls.</p></div><br><button class="btn primary" id="agree">I understand, turn on the mic</button> <button class="btn" data-close>Not now</button>`);
    $('#agree').onclick = async () => { await api('/me/voice-consent', { method: 'POST' }); S.me.user.voice_consent = true; closeDrawer(); startMic(); }; return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return toast('This browser has no speech recognition. Try Chrome or Safari.');
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; const mic = $('#wave-mic'); mic.classList.add('primary'); localStorage.wl_speak = '1'; $('#wave-speak').style.opacity = 1;
  rec.onresult = (e) => { const r = e.results[e.results.length - 1]; $('#wave-input').value = r[0].transcript; if (r.isFinal) { const t = r[0].transcript; $('#wave-input').value = ''; sendWave(t); } };
  rec.onend = () => { mic.classList.remove('primary'); rec = null; }; window._audio?.pause(); rec.start();
}
async function speak(text) {
  try { window._audio?.pause(); const r = await fetch('/api/wave/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); if (!r.ok) throw 0;
    const a = new Audio(URL.createObjectURL(await r.blob())); window._audio = a; $('#orb').classList.add('talk'); a.onended = () => $('#orb')?.classList.remove('talk'); a.play(); }
  catch { if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
}

boot();
