// End-to-end browser tests (real Chrome via playwright-core) for each role.
const test = require('node:test'); const assert = require('node:assert');
const { chromium } = require('playwright-core');
const { startServer, EMAILS } = require('../helpers');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
let S, browser;
test.before(async () => { S = await startServer(); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
test.after(async () => { await browser.close(); await S.close(); });

async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(S.base + '/');
  await page.click('button:has-text("Sign in")'); assert.match(await page.textContent('#login-err'), /Enter your email/);
  await page.fill('#email', email); await page.fill('#password', 'wrong-pass'); await page.click('button:has-text("Sign in")');
  await page.waitForFunction(() => /match/.test(document.querySelector('#login-err').textContent));
  await page.fill('#password', 'TestPass!2026'); await page.click('button:has-text("Sign in")');
  await page.waitForSelector('[data-testid="next-action"]');
  return { page, ctx, errors };
}
const navLabels = (page) => page.$$eval('nav.side a[data-nav]', as => as.map(a => a.dataset.nav));
async function closeDrawerUI(page) { await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForSelector('.drawer', { state: 'detached' }); }

async function addCustomer(page, name) {
  await page.goto(S.base + '/#/customers'); await page.click('#add-customer');
  await page.fill('#customer-form [name=business]', name); await page.fill('#customer-form [name=seats]', '5');
  await page.fill('#customer-form [name=current_provider]', 'Grasshopper'); await page.check('#customer-form [name=is_test]');
  await page.click('#customer-form button[type=submit]');
  await page.waitForSelector(`.deal:has-text("${name}")`);
}
async function quoteFlow(page, name) {
  await page.goto(S.base + '/#/quotes'); await page.waitForSelector('#qnext');
  await page.click('#qnext'); assert.match(await page.textContent('#qerr'), /Choose a customer/);
  await page.selectOption('#quote-form [name=customer_id]', { label: name }); await page.fill('#quote-form [name=seats]', '5'); await page.click('#qnext');
  await page.fill('[name=amount_0]', '300'); await page.click('#qadd'); await page.fill('[name=label_1]', 'Extra numbers'); await page.fill('[name=amount_1]', '45');
  await page.click('#qcalc'); await page.waitForSelector('[data-testid=savings]');
  assert.equal((await page.textContent('[data-testid=savings]')).trim(), '$95/mo');
  await page.click('#qsave'); await page.waitForSelector('.drawer h2');
  assert.match(await page.textContent('.drawer'), /saves \$95\/mo/);
  assert.match(await page.textContent('.drawer'), /Quoted/);
}

test('Owner: full nav, CRUD, quote, reports, settings, Wave connect message', async () => {
  const { page, ctx, errors } = await signIn(EMAILS.owner);
  assert.deepEqual(await navLabels(page), ['today', 'customers', 'quotes', 'coach', 'reports', 'settings']);
  assert.ok(await page.isVisible('[data-testid=connect-ai]'));
  await addCustomer(page, '[TEST] E2E Owner Co');
  // edit + note + payment
  await page.click('.deal:has-text("E2E Owner Co")'); await page.click('#edit-c'); await page.selectOption('#customer-form [name=stage]', 'Won'); await page.click('#customer-form button[type=submit]');
  await page.waitForSelector('.col[data-stage="Won"] .deal:has-text("E2E Owner Co")');
  await page.click('.deal:has-text("E2E Owner Co")'); await page.fill('#note-form [name=body]', 'TEST note from e2e'); await page.click('#note-form button');
  await page.waitForSelector('.drawer :text("TEST note from e2e")');
  await page.fill('#payment-form [name=amount]', '250'); await page.click('#payment-form button'); await page.waitForSelector('.drawer :text("$250")');
  await closeDrawerUI(page);
  // list view + delete
  await page.click('#viewtoggle'); await page.waitForSelector('[data-testid=customer-list]');
  await page.click('tr:has-text("E2E Owner Co")'); page.once('dialog', d => d.accept()); await page.click('#del-c');
  await page.waitForFunction(() => !document.body.innerText.includes('E2E Owner Co'));
  await page.click('#viewtoggle');
  await addCustomer(page, '[TEST] E2E Quote Co'); await quoteFlow(page, '[TEST] E2E Quote Co');
  await page.goto(S.base + '/#/reports'); await page.waitForSelector('[data-testid=report-table]');
  assert.ok((await page.$$('[data-testid=report-table] tbody tr')).length >= 4);
  await page.goto(S.base + '/#/settings'); await page.waitForSelector('[data-testid=people]');
  await page.fill('#user-form [name=name]', 'E2E Hire (TEST)'); await page.fill('#user-form [name=email]', 'hire@test.waveline.local'); await page.fill('#user-form [name=password]', 'TestPass!2026');
  await page.click('#user-form button'); await page.waitForSelector('[data-testid=people] :text("hire@test.waveline.local")');
  await page.click('button[data-tab=pay]'); await page.fill('#basepct', '12'); await page.click('#save-pay'); await page.waitForSelector('#toast.on');
  await page.click('button[data-tab=slack]'); await page.waitForSelector('[data-testid=slack-log]'); assert.match(await page.textContent('[data-testid=slack-log]'), /dry_run/);
  await page.click('button[data-tab=tiers]'); await page.waitForSelector('#save-tiers');
  await page.goto(S.base + '/#/coach'); await page.waitForSelector('details.bc'); assert.equal((await page.$$('details.bc')).length, 30);
  await page.click('button[data-tab=scripts]'); await page.fill('#kq', 'restaurant'); assert.ok((await page.$$('#kbody .card')).length >= 2);
  assert.deepEqual(errors, []); await ctx.close();
});

test('Sales manager: no Settings, sees team only, can quote', async () => {
  const { page, ctx, errors } = await signIn(EMAILS.manager);
  assert.deepEqual(await navLabels(page), ['today', 'customers', 'quotes', 'coach', 'reports']);
  assert.equal((await page.textContent('[data-testid=role-pill]')).trim(), 'Sales manager');
  await page.goto(S.base + '/#/settings'); await page.waitForSelector('[data-testid=next-action]'); // falls back to Today
  await page.goto(S.base + '/#/customers'); await page.waitForSelector('[data-testid=pipeline]');
  const body = await page.textContent('[data-testid=pipeline]'); assert.ok(body.includes('Joe')); assert.ok(!body.includes('ByteFix'));
  await addCustomer(page, '[TEST] E2E Mgr Co'); await quoteFlow(page, '[TEST] E2E Mgr Co');
  await page.goto(S.base + '/#/reports'); await page.waitForSelector('[data-testid=report-table]');
  const reps = await page.textContent('[data-testid=report-table]'); assert.ok(reps.includes('Riley')); assert.ok(!reps.includes('Sam Seller'));
  assert.deepEqual(errors, []); await ctx.close();
});

test('Salesperson: own customers, own report, no delete, no Settings', async () => {
  const { page, ctx, errors } = await signIn(EMAILS.rep);
  assert.deepEqual(await navLabels(page), ['today', 'customers', 'quotes', 'coach', 'reports']);
  await page.goto(S.base + '/#/customers'); await page.waitForSelector('[data-testid=pipeline]');
  const body = await page.textContent('[data-testid=pipeline]'); assert.ok(!body.includes('Harbor Inn')); assert.ok(!body.includes('ByteFix'));
  await addCustomer(page, '[TEST] E2E Rep Co');
  await page.click('.deal:has-text("E2E Rep Co")'); assert.equal(await page.$('#del-c'), null); assert.equal(await page.$('#customer-form [name=owner_id]'), null);
  await closeDrawerUI(page);
  await quoteFlow(page, '[TEST] E2E Rep Co');
  await page.goto(S.base + '/#/reports'); await page.waitForSelector('[data-testid=report-table]');
  assert.equal((await page.$$('[data-testid=report-table] tbody tr')).length, 1);
  await page.fill('#wave-input', 'hi'); await page.click('#wave-form button.primary'); await page.waitForSelector('.msg.sys:has-text("not connected")');
  await page.click('#logout'); await page.waitForSelector('#login-form');
  assert.deepEqual(errors, []); await ctx.close();
});

test('Mobile viewport renders and nav works', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  await page.goto(S.base + '/'); await page.fill('#email', EMAILS.rep); await page.fill('#password', 'TestPass!2026'); await page.click('button:has-text("Sign in")');
  await page.waitForSelector('[data-testid="next-action"]'); await page.click('#wave-close'); await page.click('a[data-nav=coach]'); await page.waitForSelector('details.bc'); await ctx.close();
});
