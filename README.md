# OpsTally Agent

A Windows tray app that sits beside **Tally Prime**, polls its XML gateway
(`localhost:9000`), and fires signed JSON events at any webhook URL you
configure — the Razorpay webhook model. The exe is the product: install it,
paste your server's webhook URL, copy the signing secret to your server, done.

## How it works

```
Tally Prime (XML gateway :9000)
   ▲ XML export queries (polling, serialized)
OpsTally Agent (Electron tray app)
   tally-client → poller/differ → SQLite spool → dispatcher (HMAC + backoff)
   └── HTTPS POST → your server's webhook endpoint
```

- **Change detection**: ALTERID watermarks for vouchers/ledgers/masters,
  hash-diff for stock quantities and prices. First run baselines silently —
  no event flood.
- **Durability**: events spool in SQLite (`%APPDATA%/opstally-agent/agent.db`);
  a webhook outage loses nothing. Exponential backoff 30s → 6h, poison events
  parked as `failed` with manual retry in the UI.
- **Security**: every payload carries `X-Tally-Signature` — hex HMAC-SHA256 of
  the raw body with the per-install secret (DPAPI-encrypted at rest). Verify it
  server-side before trusting an event.
- **One agent, one target at a time** — v1 holds a single webhook URL + secret.
  No fan-out to multiple destinations simultaneously (see the environments
  section below for how to move between local → staging → production).

## Repo layout

| Path                     | Purpose                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `apps/agent/`            | Electron tray app — poller, SQLite spool, dispatcher, settings UI      |
| `packages/tally-client/` | Plain-TS Tally XML client: queries, parsers, price resolvers, probe CLI |
| `tools/webhook-sink/`    | Zero-dep test receiver that verifies signatures                        |

---

## Getting started (first time on this machine)

```bash
cd "c:\Users\Pulin\Desktop\Dev Cell\ops-tally"
npm install
```

`npm install` also rebuilds `better-sqlite3`'s native binding for your Node/Electron
ABI. If you ever see `Could not locate the bindings file`, run `npm rebuild`.
Native module install scripts (`better-sqlite3`, `electron`, `esbuild`,
`electron-winstaller`) are pre-approved in root `package.json` → `allowScripts`.

### Launch in dev mode

```bash
npm run dev:agent
```

This runs `electron-vite dev` — Electron window with hot reload; main-process
edits restart it, renderer edits hot-swap.

### What happens the very first time (empty `%APPDATA%`)

1. Tray icon appears (grey — nothing configured yet).
2. Settings window **auto-opens** — no webhook URL is set, so [index.ts](apps/agent/src/main/index.ts) forces
   it open so you can't miss setup.
3. A signing secret is generated automatically and encrypted at rest
   (Windows DPAPI via `safeStorage`) — nothing to type.
4. The poller is running but idle: no company is configured yet, so every
   poll tick is a no-op.
5. **Connection tab** — host `localhost`, port `9000` are pre-filled. Open
   Tally Prime on this machine with a company loaded, then click **Test
   connection** or **Load from Tally** to pull the live company list and
   pick one. (If Tally isn't open yet, this correctly reports "Tally is not
   running" — open Tally and retry.)
6. The moment a company is set, the next poll is a **silent baseline**:
   it snapshots every voucher/stock item/ledger into local SQLite and
   records the current AlterID watermark, but fires **zero webhook events**
   — day one doesn't blast your server with thousands of "new" records.
7. **Webhook tab** — paste your server's webhook URL, click **Reveal** to
   see the secret, **Copy** it into your server's `TALLY_WEBHOOK_SECRET` env
   var. **Send test event** fires a signed `ping` directly (bypasses the
   queue) so you can confirm the wire end-to-end before touching real data.

### What happens every time after (steady state)

- Config (webhook URL, host/port, company, intervals) lives in
  `electron-store` under `%APPDATA%/opstally-agent`; all sync state
  (snapshots, watermarks, the event queue) lives in
  `%APPDATA%/opstally-agent/agent.db`. Both persist across restarts —
  reopening the app does **not** re-baseline, it picks up exactly where
  it left off.
- Each entity polls on its own interval (defaults: vouchers 2 min, stock
  10 min, ledgers 30 min — configurable in the Polling tab). Vouchers and
  ledgers query Tally for `AlterID > watermark` only; stock is hash-diffed
  every poll (quantity is a computed value, so its AlterID never moves).
- Anything new or changed becomes a row in the local event queue, and the
  dispatcher (ticking every 5s) drains it FIFO: sign, POST, mark
  delivered — or back off (30s → 2m → 10m → 30m → 2h → 6h, `failed` after
  12 attempts, retryable from the **Deliveries** tab).
- Restarting mid-backlog loses nothing — the queue is on disk.
- **Auto re-baseline** happens only in two cases: you switch company
  (all state for that install is wiped and rebuilt), or Tally's live
  AlterID is found *lower* than the stored watermark — meaning the
  company was restored from an older backup — in which case that entity
  (and vouchers, which share the same counter) resets and silently
  re-snapshots rather than firing a flood of false "changes".

### Closing vs quitting

Closing the settings window just hides it to the tray (`win.on('close')`
intercepts it). Tray → **Quit** actually exits the process. Tray →
double-click the icon reopens settings any time.

---

## The `probe` CLI

A one-shot diagnostic, separate from the running agent — it touches no
SQLite state, enqueues no events, calls no webhook. Its only job: connect
to a real Tally instance and report facts your design depends on.

```bash
cd packages/tally-client
npm run probe -- --port 9000 --company "Your Company Name" --save-fixtures test/fixtures
```

(Run it from inside `packages/tally-client`, not the repo root — nested
`npm run -w` argument forwarding gets ambiguous otherwise.)

What it prints: every company Tally has loaded, then for stock items,
ledgers, and vouchers (last 90 days) — count, max AlterID, GUID coverage,
and one sample record. It ends with a verdict on whether AlterID-based
watermark detection is viable for this Tally install (it should be — AlterID
is a standard Tally feature — but the design explicitly plans for the
fallback: if AlterID coverage is missing, the differ's hash-diff mode
becomes the default in [differ.ts](apps/agent/src/main/engine/differ.ts), no redesign needed).

`--save-fixtures <dir>` writes the raw XML responses to disk — good real-world
fixtures to add next to the synthetic ones in `packages/tally-client/test/fixtures/`.

**Run this once against your actual Tally before relying on the agent in
production.**

---

## Moving from local → staging → production

The one thing that never changes across environments: **Tally is always
local** (or LAN). The agent talks to `localhost:9000` (or a LAN IP)
regardless of which server it's reporting to. The *only* setting that
changes between environments is the **Webhook URL** in the Webhook tab.

**Local testing** — before touching a real server, verify signatures with
the bundled sink:

```bash
node tools/webhook-sink/sink.js 4000
```

It'll tell you to set `WEBHOOK_SECRET` — copy it from the agent's Webhook
tab (Reveal), then:

```bash
WEBHOOK_SECRET=whsec_... node tools/webhook-sink/sink.js 4000
```

Point the agent's Webhook URL at `http://localhost:4000`. Trigger a change
in Tally (edit a stock qty, save a voucher), hit **Sync now** in the
Polling tab, and watch the sink terminal print `✓ stock.updated` /
`✓ voucher.created` — it verifies the HMAC signature itself.

**Staging** — flip the Webhook URL to your staging domain
(`https://staging.example.com/api/v1/tally/webhook`), paste the same
secret into staging's `TALLY_WEBHOOK_SECRET` env var. Nothing else changes.

**Production** — same move: flip the URL, put the secret in prod's env.

⚠️ Because v1 holds only one active secret, regenerating it (Webhook tab →
**Regenerate**) invalidates whatever the *previous* URL's server had
configured. If you're promoting staging → production, either reuse the
same secret on both sides, or regenerate **and** update the receiving
server's env in the same step — a stale secret on either side means every
delivery 401s.

---

## Events

`voucher.created` · `voucher.updated` · `voucher.cancelled` · `stock.updated` ·
`stock.snapshot` · `ledger.created` · `ledger.updated` · `ping`

Envelope:

```json
{
  "id": "evt_…",
  "event": "stock.updated",
  "created_at": "2026-08-09T12:00:00.000Z",
  "company": "Your Company Name",
  "install_id": "…",
  "payload": { }
}
```

## Verifying signatures (server side)

```js
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(
  Buffer.from(req.headers['x-tally-signature'], 'hex'),
  Buffer.from(expected, 'hex')
);
```

Mount the webhook route with a **raw body parser** — the signature covers the
exact bytes, not the re-serialized JSON. See project-o's
`backend/tally/webhooks/webhookReceiver.ts` for a full example (raw-body
mount, timing-safe compare, idempotency via a unique event-id index).

## Development

```bash
npm install
npm test                 # all workspace tests
npm run dev:agent        # Electron app with HMR
npm run probe            # probe a live Tally: companies, AlterIDs, sample keys
```

## Packaging

```bash
npm run dist -w apps/agent   # NSIS installer in apps/agent/dist/
```

**Code signing is a launch prerequisite** — an unsigned background agent doing
local polling plus outbound POSTs is a SmartScreen/AV magnet. Configure signing
in `apps/agent/electron-builder.yml` (placeholders for Azure Trusted Signing
and OV/EV cert files are already in the comments) before shipping any
installer to a customer.

Production behaviors already built in:

- **Disk logs**: `%APPDATA%/opstally-agent/logs/main.log`, size-rotated —
  first place to look when a customer reports a sync issue. The tray app
  has no visible window most of the time, so this is the primary
  troubleshooting surface.
- **DB crash recovery**: a power-cut-corrupted SQLite database is moved to
  `agent.db.bak` (kept for post-mortem) and a clean one is created on boot;
  the agent re-baselines silently instead of crash-looping. Any
  undelivered spooled events are lost in that scenario — delivered events
  are unaffected.
- **Auto-update**: wired (`src/main/updater.ts`) but dormant until a
  `publish` target (GitHub Releases or S3) is uncommented in
  `electron-builder.yml` **and** builds are signed. Windows blocks
  auto-update of unsigned installers by design.
