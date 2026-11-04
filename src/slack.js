// Slack integration. Posts deal-won, payment and spiff updates.
// SAFE BY DEFAULT: nothing leaves the box unless SLACK_LIVE=true AND a webhook/bot token is set
// AND the Owner enabled Slack in Settings. Otherwise messages are recorded in slack_outbox as "dry_run".
const { getSetting } = require('./db');

function formatMessage(event, data) {
  const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  switch (event) {
    case 'deal_won': return `:tada: Deal won: *${data.business}* (${data.seats} seats, ${money(data.seats * 50)}/mo) by ${data.rep}`;
    case 'payment': return `:moneybag: Payment ${money(data.amount)} from *${data.business}* (logged by ${data.rep})`;
    case 'spiff': return `:rocket: Spiff earned: ${data.rep} gets ${money(data.amount)} (${data.spiff}) on *${data.business}*`;
    default: return String(data.text || event);
  }
}

function channelFor(cfg, event) {
  const map = { deal_won: 'deals', payment: 'payments', spiff: 'spiffs' };
  return (cfg.channels || {})[map[event]] || '#general';
}

async function notify(db, event, data, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const cfg = getSetting(db, 'slack') || {};
  if (cfg.events && cfg.events[event] === false) return null;
  const channel = channelFor(cfg, event);
  const text = formatMessage(event, data);
  const live = env.SLACK_LIVE === 'true' && cfg.enabled && (env.SLACK_WEBHOOK_URL || env.SLACK_BOT_TOKEN);
  let status = 'dry_run', error = null;
  if (live) {
    try {
      const res = env.SLACK_BOT_TOKEN
        ? await fetchImpl('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` }, body: JSON.stringify({ channel, text }) })
        : await fetchImpl(env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `[${channel}] ${text}` }) });
      status = res.ok ? 'sent' : 'failed'; if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) { status = 'failed'; error = e.message; }
  }
  db.prepare('INSERT INTO slack_outbox (event, channel, text, status, error) VALUES (?,?,?,?,?)').run(event, channel, text, status, error);
  return { event, channel, text, status };
}

module.exports = { notify, formatMessage, channelFor };
