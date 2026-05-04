require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');
const crypto = require('crypto');

const VPS_URL = process.env.VPS_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const TALLY_PORT = process.env.TALLY_PORT || '9000';
const TALLY_URL = `http://localhost:${TALLY_PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('[Relay] CRITICAL: CLIENT_ID or CLIENT_SECRET is missing in .env!');
  process.exit(1);
}

function log(level, msg) {
  console.log(`[${new Date().toISOString()}] [${level}] [${CLIENT_ID}] ${msg}`);
}

function connect() {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', CLIENT_SECRET)
    .update(CLIENT_ID + timestamp)
    .digest('hex');

  const connectionUrl = `${VPS_URL}?clientId=${CLIENT_ID}&timestamp=${timestamp}&signature=${signature}`;
  log('INFO', `Connecting to cloud at ${VPS_URL}...`);
  const ws = new WebSocket(connectionUrl, {
    rejectUnauthorized: false
  });

  ws.on('open', () => {
    log('INFO', 'Connected to VPS bridge');

    // Fix 7: Send a ping every 30 s so we detect silently-stuck connections early.
    // If the pong doesn't come back the 'close' event fires and we reconnect.
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        log('DEBUG', 'Heartbeat ping sent');
      } else {
        clearInterval(heartbeat);
      }
    }, 30_000);

    ws.on('pong', () => log('DEBUG', 'Heartbeat pong received'));
    ws.once('close', () => clearInterval(heartbeat));
  });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      log('WARN', 'Received non-JSON message from VPS');
      return;
    }

    const { jobId, xml } = msg;
    log('INFO', `Forwarding job ${jobId} to Tally`);

    try {
      const response = await axios.post(TALLY_URL, xml, {
        headers: { 'Content-Type': 'text/xml' },
        timeout: 60000,
      });
      ws.send(JSON.stringify({ jobId, response: response.data }));
      log('INFO', `Job ${jobId} completed OK`);
    } catch (err) {
      const isTallyDown = err.code === 'ECONNREFUSED';
      const errorMsg = isTallyDown
        ? 'Tally is not running — please open Tally Prime'
        : err.message;
      log('ERROR', `Job ${jobId} failed: ${errorMsg}`);
      ws.send(JSON.stringify({ jobId, error: errorMsg }));
    }
  });

  ws.on('close', () => {
    log('WARN', 'Disconnected from VPS — reconnecting in 5s...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    log('ERROR', `WebSocket error: ${err.message}`);
    // 'close' event will fire after error and trigger reconnect
  });

  process.on('SIGINT', () => {
    log('INFO', 'Shutting down relay gracefully...');
    ws.close();
    process.exit(0);
  });
}

connect();
