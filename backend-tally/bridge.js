const { WebSocketServer } = require('ws');

let relaySocket = null;
const pending = new Map();
let jobCounter = 0;

function init(server) {
  const wss = new WebSocketServer({ server, path: '/tally-relay' });

  wss.on('connection', (ws, req) => {
    console.log(`[Bridge] Relay agent connected from ${req.socket.remoteAddress}`);
    relaySocket = ws;

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return console.error('[Bridge] Invalid JSON from relay:', data.toString().slice(0, 100));
      }

      const job = pending.get(msg.jobId);
      if (!job) return;

      clearTimeout(job.timeout);
      pending.delete(msg.jobId);

      if (msg.error) {
        job.reject(new Error(msg.error));
      } else {
        job.resolve(msg.response);
      }
    });

    ws.on('close', () => {
      console.warn('[Bridge] Relay agent disconnected');
      if (relaySocket === ws) relaySocket = null;
      // reject all pending jobs so queue can retry
      for (const [id, job] of pending) {
        clearTimeout(job.timeout);
        job.reject(new Error('Relay disconnected'));
        pending.delete(id);
      }
    });

    ws.on('error', (err) => {
      console.error('[Bridge] WebSocket error:', err.message);
    });
  });

  console.log('[Bridge] WebSocket server listening on /tally-relay');
}

function sendToTally(xml) {
  return new Promise((resolve, reject) => {
    if (!relaySocket || relaySocket.readyState !== 1 /* OPEN */) {
      return reject(new Error('Relay agent not connected'));
    }

    const jobId = `job_${Date.now()}_${++jobCounter}`;

    const timeout = setTimeout(() => {
      pending.delete(jobId);
      reject(new Error(`Tally request timed out after 10s (jobId: ${jobId})`));
    }, 10_000);

    pending.set(jobId, { resolve, reject, timeout });
    relaySocket.send(JSON.stringify({ jobId, xml }));
  });
}

module.exports = { init, sendToTally };
