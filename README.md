# WaveLine Sales Hub — v1

Sales hub for WaveLine reps ($50/user/mo team phone). Node 24 + Express + built-in `node:sqlite`, vanilla-JS SPA.

## Run
    npm install
    cp .env.example .env   # optional: add OPENAI_API_KEY
    npm start              # http://localhost:4300

## Test logins (TEST data only), password `TestPass!2026`
- owner@test.waveline.local — Owner (everything + Settings)
- manager@test.waveline.local — Sales manager (own team)
- rep@test.waveline.local, rep2@test.waveline.local — Salesperson (own customers)

## Tests
    npm test   # unit + API + Playwright e2e (system Chrome at /usr/bin/google-chrome, override CHROME_PATH)

## Pages
Today · Customers (pipeline board/list, notes, payments) · Quotes (3-step bill comparison) · Coach (30 battlecards, objections, scripts by industry, plays, practice) · Reports (commission + spiffs) · Settings (Owner: people, tier access, commission & spiff rules, Slack log, Wave AI setup).

## Wave
Tool-calling LLM (navigate, fill_form as drafts the user confirms, search_knowledge, list_customers). Without a key, the app shows "Connect AI". Voice: browser speech recognition in, `/api/wave/tts` (voice `shimmer`) out, browser speechSynthesis fallback. A recording/AI consent notice is shown before the mic turns on.

## Slack
`src/slack.js` dry-runs by default. Every event (deal won, spiff earned, payment) is written to `slack_outbox` and shown in Settings > Slack log. Real sends require SLACK_LIVE=true, the Owner enabling Slack, and a webhook or token.

### Streaming
`POST /api/wave/chat` with `"stream": true` returns server-sent events (`delta`, `action`, `done`, `error`); the UI streams Wave's text as it arrives. Live Wave tests (`tests/e2e/wave-live.test.js`) run only when OPENAI_API_KEY is set.
