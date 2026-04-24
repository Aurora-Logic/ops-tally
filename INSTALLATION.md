# Installation & Setup Guide — OPS ↔ Tally Prime Integration

This guide covers every step required to get the bidirectional sync running between the OPS backend (on a Linux VPS) and Tally Prime (on a Windows PC). Follow the sections in order.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [VPS — Backend Setup](#3-vps--backend-setup)
4. [Windows — Node.js Installation](#4-windows--nodejs-installation)
5. [Windows — Relay Agent Setup](#5-windows--relay-agent-setup)
6. [Windows — Tally Prime HTTP Server](#6-windows--tally-prime-http-server)
7. [Windows — TDL Setup (Real-time Webhook)](#7-windows--tdl-setup-real-time-webhook)
8. [Dashboard Setup](#8-dashboard-setup)
9. [Verifying Everything Works](#9-verifying-everything-works)
10. [Production — PM2 Auto-start on Windows](#10-production--pm2-auto-start-on-windows)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [Sync Schedule Reference](#12-sync-schedule-reference)
13. [Edge Cases & Troubleshooting](#13-edge-cases--troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────┐        ┌──────────────────────────────┐
│         LINUX VPS               │        │       WINDOWS PC             │
│                                 │        │                              │
│  OPS Backend  (:1000)           │        │  Tally Prime  (:9000)        │
│  ├── Job Queue (MongoDB)        │◄──────►│  ├── HTTP XML API            │
│  ├── WebSocket Bridge           │  WebSocket  ├── TDL (ops-sync.tdl)   │
│  ├── Tally Admin API            │  /tally-relay  └── Voucher events    │
│  └── Webhook Receiver           │        │                              │
│                                 │        │  Relay Agent (relay.js)      │
│  Tally Dashboard  (:5174)       │        │  └── Connects VPS ↔ Tally   │
└─────────────────────────────────┘        └──────────────────────────────┘
```

**Data flow:**
- **OPS → Tally**: Order placed / dealer created in OPS → job queued in MongoDB → sent through relay → Tally XML API creates voucher
- **Tally → OPS**: TDL fires HTTP POST to VPS on every voucher save (real-time). Scheduled jobs pull stock levels and ledgers every 15–30 min.

---

## 2. Prerequisites

### VPS (Linux)
- OPS backend running on port `1000`
- MongoDB connected
- Port `1000` open for inbound TCP (including WebSocket upgrades)
- Node.js ≥ 18

### Windows PC
- Tally Prime installed and licensed
- A company loaded in Tally (must be open while sync is active)
- Internet access to reach the VPS
- Node.js ≥ 18 (installation covered in Section 4)

### Files needed from this repo
```
backend-tally/        → copy into OPS backend/tally/
TallyJob.ts           → copy into OPS backend/models/
tallyAdmin.ts         → copy into OPS backend/routes/
ops-patches/          → merge these three files into your OPS repo
tally-relay/          → copy the entire folder to the Windows PC
backend-tally/ops-sync.tdl  → copy this single file to the Windows PC
tally-dashboard/      → run on any machine that can reach the VPS
```

---

## 3. VPS — Backend Setup

### 3.1 Copy files into your OPS repo

```bash
# From the root of your OPS repo (gc_ops):
cp -r backend-tally/          backend/tally/
cp    TallyJob.ts              backend/models/TallyJob.ts
cp    tallyAdmin.ts            backend/routes/tallyAdmin.ts
```

### 3.2 Merge the patched OPS files

The `ops-patches/` folder contains three modified files. Apply the changes manually to avoid overwriting your own code:

**`ops-patches/server.ts`** — adds three lines to `server.ts`:
```ts
// At the top, before mongoose.connect():
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // only needed in dev/self-signed cert

// After tallyResumeOnStartup():
const { startCustomerSyncJob } = _require('./tally/jobs/customerSyncJob');
const { startStockSyncJob }    = _require('./tally/jobs/stockSyncJob');
startCustomerSyncJob();
startStockSyncJob();
```

**`ops-patches/updatedOrderHistoryController.ts`** — adds Tally sync hooks:
- On new order save → `syncSalesOrder()`
- On order status → InTransit → `syncSalesOrder()` (invoice)

**`ops-patches/dealerController.ts`** — adds:
- On dealer create → `syncCustomer()`
- On dealer update → `syncCustomer()`

> If you prefer, simply replace the three files completely with the patched versions. No existing logic is removed — only fire-and-forget Tally calls are added after the main save.

### 3.3 Mount the route in server.ts

Add to your Express route mounting section:

```ts
import tallyAdminRouter from './routes/tallyAdmin';
app.use('/api/tally', tallyAdminRouter);
```

### 3.4 Install dependencies

```bash
npm install fast-xml-parser ws node-cron
```

### 3.5 Restart the backend

```bash
# If using PM2:
pm2 restart ops-backend

# Or directly:
node dist/server.js
```

You should see in the logs:
```
[Bridge] WebSocket server listening on /tally-relay
[CustomerSyncJob] Scheduled: every 15 min, 08:00–20:00 IST
[StockSync] Scheduled: every 30 min
```

---

## 4. Windows — Node.js Installation

### 4.1 Download

Go to [nodejs.org](https://nodejs.org) and download the **LTS** installer (`.msi`).

### 4.2 Install

Run the installer. On the "Custom Setup" screen:
- Keep everything checked including **"Add to PATH"**
- Check **"Automatically install necessary tools"** if shown

### 4.3 Verify

Open **Command Prompt** (`Win + R` → `cmd`) and run:

```cmd
node --version
npm --version
```

Both should print version numbers (e.g. `v20.x.x` and `10.x.x`).

> **Edge case**: If `node` is not found after install, restart the Command Prompt. If still missing, search "Environment Variables" in Start → Edit the system environment variables → under "System variables" find `Path` → verify `C:\Program Files\nodejs\` is listed.

---

## 5. Windows — Relay Agent Setup

The relay agent is a small Node.js script that sits on the Windows PC, connects to the VPS over WebSocket, and forwards XML requests to Tally's local HTTP API.

### 5.1 Copy the folder

Copy the `tally-relay/` folder from this repo to the Windows PC. Suggested location:

```
C:\ops-tally\tally-relay\
```

### 5.2 Install dependencies

Open Command Prompt, navigate to the folder, and install:

```cmd
cd C:\ops-tally\tally-relay
npm install
```

### 5.3 Edit the PM2 config with your VPS address

Open `ecosystem.config.js` in Notepad and replace the `VPS_URL`:

```js
env: {
  VPS_URL: 'ws://YOUR_VPS_IP:1000/tally-relay',  // use ws:// for HTTP, wss:// for HTTPS
  TALLY_PORT: '9000',
},
```

> **Important**: Use `ws://` if your VPS backend runs on plain HTTP. Use `wss://` only if you have an SSL certificate on the VPS and the backend uses HTTPS.

### 5.4 Test run (before setting up PM2)

```cmd
set VPS_URL=ws://YOUR_VPS_IP:1000/tally-relay
set TALLY_PORT=9000
node relay.js
```

You should see:
```
[INFO] Connecting to VPS at ws://YOUR_VPS_IP:1000/tally-relay
[INFO] Connected to VPS WebSocket
```

And on the **VPS logs** you should see:
```
[Bridge] Relay agent connected from <windows-ip>
```

Verify on the dashboard: open `http://YOUR_VPS_IP:5174` → header badge should show **"Relay connected"** in green.

> **Edge case — firewall blocking**: If the relay cannot connect, check that port `1000` is open on the VPS. On Ubuntu/Debian:
> ```bash
> sudo ufw allow 1000/tcp
> ```
> On the Windows side, if a corporate firewall blocks outbound WebSocket, try port `443` (requires an Nginx/Caddy reverse proxy on the VPS mapped to the backend).

> **Edge case — relay connects then immediately drops**: The VPS backend is not running or crashed. Check `pm2 logs ops-backend` on the VPS.

---

## 6. Windows — Tally Prime HTTP Server

Tally Prime has a built-in HTTP XML server that the relay forwards requests to. It must be enabled.

### 6.1 Enable the HTTP server

1. Open Tally Prime
2. Press **F12** (Configure)
3. Go to **Advanced Configuration**
4. Find **"Enable ODBC Server"** — set to **Yes**
5. Set the port to **9000** (or match whatever you set in `TALLY_PORT`)
6. Press **Enter / Accept** to save

> In some versions of Tally Prime this is under **F12 → Connectivity** rather than Advanced Configuration. Look for "Tally Gateway Server" or "ODBC Server".

### 6.2 Keep a company open

Tally only responds to XML queries when a company is loaded. If no company is open, all relay requests will return an error and jobs will stay in `retrying` state.

### 6.3 Verify Tally is responding

With the relay running, go to the dashboard and check the relay status. Then on the VPS run:

```bash
curl -s http://localhost:1000/api/tally/stock
```

If it returns `{"ok":true,"items":[...]}` — Tally is connected and responding.

If it returns `{"ok":false,"error":"Relay agent not connected"}` — the relay is not running or has not connected.

If it returns `{"ok":false,"error":"Tally request timed out"}` — the relay is connected to the VPS but Tally is not responding locally. Check that the Tally HTTP server is enabled and a company is open.

---

## 7. Windows — TDL Setup (Real-time Webhook)

The TDL (Tally Definition Language) file makes Tally push data to OPS every time a voucher is saved, enabling real-time payment and invoice tracking.

### 7.1 Edit the TDL file

Copy `backend-tally/ops-sync.tdl` to the Windows PC (e.g. `C:\ops-tally\ops-sync.tdl`).

Open it in Notepad and replace the server URL on this line:

```
Default : "http://YOUR_VPS_IP:1000/api/tally/webhook"
```

With your actual VPS address, e.g.:
```
Default : "http://203.0.113.45:1000/api/tally/webhook"
```

Save the file.

### 7.2 Load the TDL in Tally Prime

1. Open Tally Prime
2. Press **F12** (Configure)
3. Go to **Advanced Configuration**
4. Go to **TDL & Add-on**
5. Under **"TDP File Paths for Add-on TDL"**, press **Enter** on an empty row
6. Type the full path to the file: `C:\ops-tally\ops-sync.tdl`
7. Press **Enter**, then **Accept (Ctrl+A)**

Tally will reload. You should see no error messages — if Tally shows a TDL error, the file path is wrong or the file has a syntax issue.

### 7.3 Test the TDL

1. In Tally, create or open any **Receipt voucher** (a payment from a dealer)
2. Save it with **Ctrl+A**
3. On the dashboard, click the **"Tally Events"** tab
4. You should see a new row appear with `voucherType: Receipt`, the party name, and the amount

> **Edge case — TDL loads but no events appear**: The VPS URL in the TDL might be unreachable from Windows. Test from Command Prompt:
> ```cmd
> curl http://YOUR_VPS_IP:1000/api/tally/relay/status
> ```
> If it fails, check Windows Firewall and VPS firewall rules.

> **Edge case — Tally shows "HTTP Post failed" in logs**: The VPS backend is down or the URL is wrong. Check `http://YOUR_VPS_IP:1000/api/tally/relay/status` from a browser.

> **Edge case — TDL causes Tally to slow down on save**: This is rare but can happen if the VPS is unreachable and the HTTP call blocks. Set a shorter timeout in the TDL or ensure the VPS is always reachable before enabling TDL in production.

---

## 8. Dashboard Setup

The dashboard is a React + Vite app. Run it on any machine that can reach the VPS.

### 8.1 Install and start

```bash
cd tally-dashboard
npm install
npm run dev
```

Opens at `http://localhost:5174`.

### 8.2 Point it at your VPS

Edit `tally-dashboard/vite.config.ts` — change the proxy target:

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://YOUR_VPS_IP:1000',
      changeOrigin: true,
    },
  },
},
```

### 8.3 Build for production (optional)

```bash
npm run build
# Output in dist/ — serve with nginx, caddy, or any static host
```

---

## 9. Verifying Everything Works

Run these checks in order. Each one depends on the previous.

### Check 1 — Relay connected
```bash
curl http://YOUR_VPS_IP:1000/api/tally/relay/status
# Expected: {"ok":true,"connected":true}
```

### Check 2 — Tally responding (stock fetch)
```bash
curl http://YOUR_VPS_IP:1000/api/tally/stock
# Expected: {"ok":true,"items":[...]}
```

### Check 3 — OPS → Tally: sales order job
```bash
curl -X POST http://YOUR_VPS_IP:1000/api/tally/test/sales-order \
  -H "Content-Type: application/json" \
  -d '{"customerName":"Test Customer","items":[{"name":"Steel Rod 10mm","qty":2,"rate":120,"gstRate":18}]}'
# Expected: {"ok":true,"jobId":"...","type":"salesOrder"}
```

Wait 2–3 seconds, then check the job succeeded:
```bash
curl "http://YOUR_VPS_IP:1000/api/tally/jobs?limit=1"
# Expected: jobs[0].status === "success"
```

### Check 4 — OPS → Tally: customer sync
```bash
curl -X POST http://YOUR_VPS_IP:1000/api/tally/test/customer \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Dealer Pvt Ltd","phone":"9999999999"}'
# Expected: {"ok":true,"jobId":"...","type":"customer"}
```

### Check 5 — Tally → OPS: force stock sync
```bash
curl -X POST http://YOUR_VPS_IP:1000/api/tally/sync/stock
# Expected: {"ok":true,"message":"Stock sync triggered"}
```

### Check 6 — Tally → OPS: force customer sync
```bash
curl -X POST http://YOUR_VPS_IP:1000/api/tally/sync/customers
# Expected: {"ok":true,"total":N,"upserted":N,"errors":0}
```

### Check 7 — TDL webhook (requires TDL loaded in Tally)

Save any Receipt or Sales voucher in Tally, then:
```bash
curl "http://YOUR_VPS_IP:1000/api/tally/events?limit=5"
# Expected: events array contains the voucher you just saved
```

All 7 checks passing = fully operational.

---

## 10. Production — PM2 Auto-start on Windows

For the relay to survive reboots and Tally restarts, run it with PM2.

### 10.1 Install PM2 globally

```cmd
npm install -g pm2
npm install -g pm2-windows-startup
```

### 10.2 Start the relay via PM2

```cmd
cd C:\ops-tally\tally-relay
pm2 start ecosystem.config.js
```

### 10.3 Enable auto-start on Windows boot

```cmd
pm2-startup install
pm2 save
```

This creates a Windows Task Scheduler entry that starts PM2 (and the relay) automatically at boot, even before any user logs in.

### 10.4 Useful PM2 commands

```cmd
pm2 status                    # see running processes
pm2 logs tally-relay          # live log stream
pm2 logs tally-relay --lines 100   # last 100 lines
pm2 restart tally-relay       # manual restart
pm2 stop tally-relay          # stop without removing
pm2 delete tally-relay        # remove from PM2
```

### 10.5 Log files location

```
C:\ops-tally\tally-relay\logs\relay-out.log   ← stdout
C:\ops-tally\tally-relay\logs\relay-err.log   ← errors
```

---

## 11. Environment Variables Reference

### Relay agent (`tally-relay/`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VPS_URL` | Yes | — | WebSocket URL of the VPS backend, e.g. `ws://1.2.3.4:1000/tally-relay` |
| `TALLY_PORT` | No | `9000` | Local port Tally Prime's HTTP server listens on |

### OPS backend (`backend/`)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB connection string |
| `PORT` | No (default 1000) | Port the backend listens on |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Dev only | Set to `0` to bypass self-signed SSL certs in development |

### TDL file (`ops-sync.tdl`)

Edit directly in the file — not an environment variable:

| Setting | Line | Description |
|---------|------|-------------|
| `OPS Server URL` | `Default : "http://..."` | Full URL of the VPS webhook endpoint |

---

## 12. Sync Schedule Reference

| Direction | What | Trigger | Frequency |
|-----------|------|---------|-----------|
| OPS → Tally | New sales order | Order placed in OPS | Immediate (seconds) |
| OPS → Tally | Sales invoice | Order status → InTransit | Immediate |
| OPS → Tally | New customer ledger | Dealer created in OPS | Immediate |
| OPS → Tally | Update customer ledger | Dealer updated in OPS | Immediate |
| Tally → OPS | Stock levels | Cron schedule | Every 30 min (always) |
| Tally → OPS | Dealer/ledger list | Cron schedule | Every 15 min, 8am–8pm IST |
| Tally → OPS | Payment received | TDL voucher save | Immediate (requires TDL) |
| Tally → OPS | Sales invoice confirmed | TDL voucher save | Immediate (requires TDL) |

Failed OPS → Tally jobs are retried with exponential backoff (5 s → 10 s → 20 s... up to 5 retries). After 5 failures the job status becomes `failed` and is visible on the dashboard for manual retry.

---

## 13. Edge Cases & Troubleshooting

### Relay keeps disconnecting

**Symptom**: Dashboard shows relay offline repeatedly.

**Causes & fixes**:
- Tally is closed or company not loaded → keep Tally open
- VPS backend restarted → relay auto-reconnects in ~5 s, no action needed
- Windows went to sleep → disable sleep for the PC (Control Panel → Power Options → Never sleep)
- Antivirus blocking outbound WebSocket → add `node.exe` to antivirus exclusions

---

### Jobs stuck in `retrying`

**Symptom**: Dashboard shows pending or retrying jobs that never succeed.

**Causes & fixes**:
- Relay not connected → fix relay first (Check 1)
- Relay connected but Tally not responding → Tally HTTP server not enabled, or no company open (Section 6)
- Tally is open but on a dialog/voucher edit screen → Tally's HTTP API does not respond when a modal is open; close the modal
- Wrong company open in Tally → the voucher may succeed but land in the wrong company

---

### Stock not updating in OPS products

**Symptom**: `POST /api/tally/sync/stock` returns `ok:true` but product `stockqty` doesn't change.

**Cause**: The stock sync matches by item name. The product's `item` field in OPS must match the Stock Item name in Tally **exactly** (comparison is case-insensitive but spelling must match).

**Fix**: Check the exact item name in Tally (Inventory Info → Stock Items) and ensure the OPS product's `item` field is identical.

---

### Duplicate vouchers appearing in Tally

**Symptom**: The same order creates two or more vouchers in Tally.

**Cause**: If a job is retried after a partial success (e.g. Tally saved the voucher but the response was lost), the retry creates another voucher.

**Fix**: Enable Tally's duplicate voucher check — in Tally press **F11 → Accounting Features → "Warn on Duplicate Voucher Numbers"** → Yes. This makes Tally warn the user but does not prevent the API from creating it. For strict prevention, TDL-level deduplication is needed (requires custom TDL development).

---

### Customer name shows as ObjectId in Tally voucher

**Symptom**: The party name on the Tally sales order appears as a MongoDB ID like `64abc123...`.

**Cause**: The product lookup for the order item failed — `item._productName` was not set correctly in the controller.

**Fix**: Ensure the OPS `Product` model has the `item` field populated for all products. Run:
```js
db.products.find({ item: { $exists: false } })
```
Any products without an `item` field need to be updated.

---

### TDL events not appearing on dashboard

**Symptom**: Vouchers are saved in Tally but the Tally Events tab stays empty.

**Checks**:
1. Is the TDL file loaded? In Tally go to **F12 → TDL & Add-on** and confirm the file path is there.
2. Is the VPS reachable from Windows? Test: `curl http://YOUR_VPS_IP:1000/api/tally/relay/status` from Windows Command Prompt.
3. Check Tally's log file for `[OPS-Sync]` entries: `C:\Users\<user>\AppData\Roaming\Tally Solutions\TallyPrime\tally.log`
4. Is the URL in the TDL correct? Open `ops-sync.tdl` in Notepad and verify the `Default :` line has the right IP.

---

### MongoDB buffering timeout on startup

**Symptom**: Backend crashes on start with `MongooseError: Operation buffering timed out`.

**Cause**: A Tally job tried to query MongoDB before the connection was established.

**Fix** (already in `backend-tally/queue.js`): The `resumeOnStartup()` function waits for the `connected` event before querying. If you see this error, ensure you're using the patched `queue.js` from this repo.

---

### `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` on startup

**Symptom**: Backend crashes on connect with a TLS certificate error.

**Cause**: The Node.js environment doesn't have the CA certificates to verify Atlas's SSL cert (common in minimal Linux environments).

**Fix**: Add this line at the very top of `server.ts`, before `mongoose.connect()`:
```ts
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
```
> Only use this in development. In production, install the CA certificates: `apt-get install ca-certificates`

---

### Relay agent cannot find `ws` module

**Symptom**: `Error: Cannot find module 'ws'` when starting relay.js.

**Fix**: Run `npm install` inside the `tally-relay/` folder on the Windows machine. The `node_modules` folder is not included in the repo.

---

*For questions or issues, open a GitHub issue at [Aurora-Logic/ops-tally](https://github.com/Aurora-Logic/ops-tally).*
