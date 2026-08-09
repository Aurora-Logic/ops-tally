/**
 * Zero-dependency webhook sink for end-to-end testing the OpsTally Agent.
 *
 *   WEBHOOK_SECRET=whsec_... node sink.js [port]
 *
 * Verifies X-Tally-Signature (hex HMAC-SHA256 over the raw body) and logs
 * every event. Returns 401 on bad signature, 200 otherwise.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = process.env.WEBHOOK_SECRET ?? '';
const port = parseInt(process.argv[2] ?? '4000', 10);

if (!secret) {
  console.error('Set WEBHOOK_SECRET (the agent signing secret) before starting.');
  process.exit(1);
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const sig = String(req.headers['x-tally-signature'] ?? '');
    const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const valid =
      sig.length === expected.length &&
      timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));

    if (!valid) {
      console.log(`✗ INVALID SIGNATURE  event=${req.headers['x-tally-event']} id=${req.headers['x-tally-event-id']}`);
      res.writeHead(401);
      res.end('invalid signature');
      return;
    }

    const envelope = JSON.parse(body);
    console.log(
      `✓ ${envelope.event}  id=${envelope.id}  company=${envelope.company}  ` +
        `payload=${JSON.stringify(envelope.payload).slice(0, 120)}`
    );
    res.writeHead(200);
    res.end('ok');
  });
}).listen(port, () => console.log(`webhook-sink listening on http://localhost:${port}`));
