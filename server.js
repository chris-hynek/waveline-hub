// Load .env if present (no dependency needed).
const fs = require('fs'); const path = require('path');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { open, seed } = require('./src/db');
const { createApp } = require('./src/app');
const db = open(process.env.DB_FILE || path.join(__dirname, 'data', 'waveline.db'));
if (process.env.SEED_TEST_DATA !== 'false') seed(db);
const port = Number(process.env.PORT || 4300);
createApp(db).listen(port, () => console.log(`WaveLine Sales Hub on http://localhost:${port}  (AI ${process.env.OPENAI_API_KEY ? 'connected' : 'NOT connected'}, Slack ${process.env.SLACK_LIVE === 'true' ? 'LIVE' : 'dry-run'})`));
