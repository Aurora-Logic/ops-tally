# Wiring Tally into app.ts

## 1. Add imports near the top of app.ts (after existing imports)

```ts
import tallyAdminRoutes from './routes/tallyAdmin';

// CommonJS bridge modules — TS can require() these at runtime
const { init: initTallyBridge } = require('./tally/bridge');
const { resumeOnStartup } = require('./tally/queue');
const { startCustomerSyncJob } = require('./tally/jobs/customerSyncJob');
```

## 2. Mount the admin route (alongside other app.use() route blocks)

```ts
app.use('/api/tally', tallyAdminRoutes);
```

## 3. Attach the WebSocket bridge and start cron AFTER the server variable is created

The existing app.ts already has `const server = http.createServer(app)`.
Add these three lines directly after that line:

```ts
const server = http.createServer(app);

// ── Tally integration ──────────────────────────────────────────────
initTallyBridge(server);   // attach WS server on /tally-relay
resumeOnStartup();         // flush any jobs left pending before last shutdown
startCustomerSyncJob();    // cron: sync dealers from Tally every 15 min
// ──────────────────────────────────────────────────────────────────
```

## 4. Install npm packages in backend/

```bash
npm install ws fast-xml-parser axios node-cron
npm install --save-dev @types/ws @types/node-cron
```

## Notes
- The bridge attaches to the *same* server that Socket.IO uses — no port conflict.
- In production (HTTPS), attach to `httpsServer` instead:
  `initTallyBridge(httpsServer);`
- The bridge only allows one relay connection at a time (office PC).
  Adding a second relay will silently replace the first.
