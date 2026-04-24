# OPS ↔ Tally Prime Integration

Bidirectional sync between the OPS ordering platform and Tally Prime.

## What's in this repo

| Folder | Purpose |
|--------|---------|
| `backend-tally/` | Core sync engine — bridge, queue, XML builders, jobs, webhook handler |
| `tally-relay/` | Windows relay agent (WebSocket ↔ Tally HTTP) |
| `tally-dashboard/` | Admin dashboard (React + Vite) — jobs, stock, TDL events, guide |
| `tally-mock/` | Local mock Tally server for dev/testing |
| `ops-patches/` | Modified OPS files — drop these into the main OPS repo |
| `TallyJob.ts` | Mongoose model for the persistent job queue |
| `tallyAdmin.ts` | Express router — `/api/tally/*` endpoints |

## Sync directions

**OPS → Tally (event-driven, real-time)**
- New order placed → Tally sales order
- Order dispatched (InTransit) → Tally invoice
- Dealer created / updated → Tally customer ledger

**Tally → OPS (scheduled + TDL webhook)**
- Stock levels → `products.stockqty` every 30 min
- Tally ledgers → OPS dealers every 15 min
- TDL webhook: voucher saves (Receipt, Sales Invoice) push in real-time

## Windows TDL setup

Copy `backend-tally/ops-sync.tdl` to the Windows machine.  
In Tally Prime: **F12 → Advanced Configuration → TDL & Add-on → Add TDP File Path** → select the file → Accept.

## Relay agent

```bash
cd tally-relay
npm install
VPS_URL=ws://YOUR_VPS:1000/tally-relay TALLY_URL=http://localhost:9000 node relay.js
# or with PM2:
npx pm2 start ecosystem.config.js
```

## Dashboard

```bash
cd tally-dashboard
npm install
npm run dev   # http://localhost:5174
```
