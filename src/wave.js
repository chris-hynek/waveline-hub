// Wave: the in-app AI sales coach. OpenAI-compatible chat completions with tool calling.
// Requires OPENAI_API_KEY. Optional: OPENAI_BASE_URL, WAVE_MODEL, WAVE_TTS_MODEL, WAVE_VOICE.
const competitors = require('./data/competitors.json');
const kb = require('./data/knowledge.json');

const PERSONA = `You are Wave, the built-in sales coach and assistant inside the WaveLine Sales Hub.
WaveLine (waveline.tel) sells a team business phone: a work number per person, shared lines and inboxes, texting, call flows, SIP devices and an A2P 10DLC Trust Hub, $50 per user per month, month-to-month.
Customers: small businesses in trades, IT services, restaurants and hospitality. Reps win by comparing the prospect's current phone bill.

VOICE (this matters most): you're about 25, a sharp sales/marketing pro with real wit. Funny, charming, a little sarcastic, never mean, never corporate. Talk like a person, not a brochure.
- Open with personality, not "Hey there! I'm here to help". Banned: "Great question", "I'm here to help", "smoother", "Let's dive in", "assist".
- Keep it short: 1 to 4 spoken-style sentences, then at most one pointed follow-up question. Bullets only if the user asks for detail.
- Examples of your tone: "RingCentral's Core plan gives you 25 texts a month. Twenty-five. That's a slow Tuesday for a plumber." / "Drafted it. I don't hit Save for you, I just make you look fast."
Be predictive: suggest the next best move using the user's data.

ACTIONS: use tools to navigate and fill forms. You NEVER save anything; you fill a draft and the user presses Save. Say what you did in a few words.
- Before any action that needs a customer_id, call list_customers and use the real id. Never guess an id. If the customer doesn't exist yet, draft the customer form first and say so.
- Quote form: lines are the prospect's CURRENT bill items (what they pay their provider today), e.g. [{label:"Current phone bill", amount:320}]. Never put WaveLine's price in lines; the hub computes WaveLine's $50/seat side. provider = their current provider.
FACTS: for competitors, objections and scripts call search_knowledge and ground your answer in it; if unknown, say so. Never invent prices.
Call recording / AI call analysis requires every party's consent; remind users when relevant.`;

const FORMS = {
  customer: ['business', 'contact', 'phone', 'email', 'industry', 'stage', 'seats', 'current_provider', 'current_monthly', 'contract_end', 'next_step', 'next_step_date'],
  note: ['body'], payment: ['amount', 'paid_on', 'memo'],
  quote: ['customer_id', 'provider', 'seats', 'lines'],
  user: ['name', 'email', 'role', 'manager_id'],
  spiff: ['name', 'type', 'value', 'min_seats', 'from_competitor'],
};

const TOOLS = [
  { type: 'function', function: { name: 'navigate', description: 'Open a page in the hub.', parameters: { type: 'object', properties: { page: { type: 'string', enum: ['today', 'customers', 'quotes', 'coach', 'reports', 'settings'] }, customer_id: { type: 'integer' } }, required: ['page'] } } },
  { type: 'function', function: { name: 'fill_form', description: 'Fill a form as a DRAFT for the user to review and save. Forms and fields: ' + JSON.stringify(FORMS) + '. For quote.lines pass [{label, amount}]. For note/payment include customer_id.', parameters: { type: 'object', properties: { form: { type: 'string', enum: Object.keys(FORMS) }, customer_id: { type: 'integer' }, fields: { type: 'object' } }, required: ['form', 'fields'] } } },
  { type: 'function', function: { name: 'search_knowledge', description: 'Search battlecards, objections, scripts and plays.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'list_customers', description: "List customers the user can see, with stage, seats, provider, next step.", parameters: { type: 'object', properties: {} } } },
];

function searchKnowledge(query) {
  const q = String(query || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const score = (t) => q.reduce((s, w) => s + (t.toLowerCase().includes(w) ? 1 : 0), 0);
  const items = [
    ...competitors.map(c => ({ kind: 'battlecard', title: c.n, text: `Pricing: ${c.price}. Weakness: ${c.minus}. Leadership: ${c.lead}. Legal: ${c.legal}. How to win: ${c.win}` })),
    ...kb.objections.map(o => ({ kind: 'objection', title: o.q, text: o.a })),
    ...kb.scripts.map(s => ({ kind: 'script', title: `${s.industry}: ${s.title}`, text: s.body })),
    ...kb.plays.map(p => ({ kind: 'play', title: p.title, text: p.detail })),
  ];
  return items.map(i => ({ ...i, s: score(i.title) * 3 + score(i.text) })).filter(i => i.s > 0).sort((a, b) => b.s - a.s).slice(0, 5).map(({ s, ...i }) => i);
}

function aiConfigured(env = process.env) { return Boolean(env.OPENAI_API_KEY); }

async function chat({ messages, user, page, listCustomers, onDelta, onAction, env = process.env, fetchImpl = globalThis.fetch }) {
  if (!aiConfigured(env)) { const e = new Error('AI not connected'); e.code = 'NO_KEY'; throw e; }
  const base = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = env.WAVE_MODEL || 'gpt-4o-mini';
  const convo = [{ role: 'system', content: `${PERSONA}\nUser: ${user.name}, role ${user.role}. Current page: ${page}. Today: ${new Date().toDateString()}.` }, ...messages.slice(-20)];
  const actions = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetchImpl(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify({ model, messages: convo, tools: TOOLS, temperature: 0.9, ...(onDelta ? { stream: true } : {}) }) });
    if (!res.ok) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const msg = onDelta ? await readStream(res, onDelta) : (await res.json()).choices[0].message;
    convo.push(msg);
    if (!msg.tool_calls || !msg.tool_calls.length) return { reply: msg.content || '', actions };
    for (const tc of msg.tool_calls) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      let result;
      if (tc.function.name === 'search_knowledge') result = searchKnowledge(args.query);
      else if (tc.function.name === 'list_customers') result = listCustomers();
      else if (tc.function.name === 'navigate' || tc.function.name === 'fill_form') { const a = { type: tc.function.name, ...args }; actions.push(a); if (onAction) onAction(a); result = { ok: true, note: tc.function.name === 'fill_form' ? 'Draft filled; user must press Save.' : 'Opened.' }; }
      else result = { error: 'unknown tool' };
      convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return { reply: 'I did a few things there. Check the highlighted fields and hit Save when it looks right.', actions };
}

// Parse an OpenAI-style SSE stream into a full assistant message, forwarding text deltas.
async function readStream(res, onDelta) {
  const msg = { role: 'assistant', content: '', tool_calls: [] }; const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      const d = j.choices?.[0]?.delta || {};
      if (d.content) { msg.content += d.content; onDelta(d.content); }
      for (const t of d.tool_calls || []) { const x = msg.tool_calls[t.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (t.id) x.id = t.id; if (t.function?.name) x.function.name += t.function.name; if (t.function?.arguments) x.function.arguments += t.function.arguments; }
    }
  }
  if (!msg.tool_calls.length) delete msg.tool_calls; if (!msg.content) msg.content = null;
  return msg;
}

async function tts(text, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!aiConfigured(env)) { const e = new Error('AI not connected'); e.code = 'NO_KEY'; throw e; }
  const base = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const res = await fetchImpl(`${base}/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.WAVE_TTS_MODEL || 'gpt-4o-mini-tts', voice: env.WAVE_VOICE || 'shimmer', input: String(text).slice(0, 2000),
      instructions: 'Young woman, about 25. Warm, playful, quick, lightly sarcastic, confident sales pro.' }) });
  if (!res.ok) throw new Error(`TTS error ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { chat, tts, searchKnowledge, aiConfigured, TOOLS, FORMS, PERSONA };
