// Live Wave tests: run only when OPENAI_API_KEY is set (skipped otherwise). Uses real AI calls.
const test = require('node:test'); const assert = require('node:assert');
const { chromium } = require('playwright-core');
const { startServer, EMAILS } = require('../helpers');
const live = !!process.env.OPENAI_API_KEY;
let S, browser, page;
test.before(async () => { if (!live) return; S = await startServer(process.env); browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(S.base + '/'); await page.fill('#email', EMAILS.rep); await page.fill('#password', 'TestPass!2026'); await page.click('button:has-text("Sign in")'); await page.waitForSelector('[data-testid="next-action"]'); });
test.after(async () => { if (browser) await browser.close(); if (S) await S.close(); });
async function ask(text) { const n = await page.$$eval('#wave-log .msg.a', m => m.length); await page.fill('#wave-input', text); await page.click('#wave-form button.primary');
  await page.waitForFunction((n) => document.querySelectorAll('#wave-log .msg.a:not(#thinking)').length > n && !document.querySelector('#thinking'), n, { timeout: 45000 });
  await page.waitForTimeout(900); return page.$$eval('#wave-log .msg.a', m => m.at(-1).textContent); }
const counts = async () => ({ customers: S.db.prepare('select count(*) n from customers').get().n, quotes: S.db.prepare('select count(*) n from quotes').get().n });

test('Wave streams a reply, navigates, drafts customer and quote without saving', { skip: !live }, async () => {
  const before = await counts();
  const r1 = await ask('Open the coach page'); assert.ok(r1.length > 3); await page.waitForFunction(() => location.hash.startsWith('#/coach'));
  await ask('Add a prospect: [TEST] Bay Plumbing, 8 seats, currently on Grasshopper');
  await page.waitForSelector('#customer-form'); assert.match(await page.inputValue('#customer-form [name=business]'), /Bay Plumbing/);
  assert.equal(await page.inputValue('#customer-form [name=seats]'), '8'); assert.ok(await page.$('#customer-form .filled'));
  assert.deepEqual(await counts(), before, 'customer draft must not save');
  await page.keyboard.press('Escape');
  await ask("Draft a quote for Joe's Diner, their current bill is 320 a month");
  await page.waitForFunction(() => location.hash.startsWith('#/quotes')); await page.waitForSelector('[name=amount_0]', { timeout: 15000 });
  assert.equal(await page.inputValue('[name=amount_0]'), '320');
  assert.deepEqual(await counts(), before, 'quote draft must not save');
});
