import { afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  postXml,
  TallyGatewayError,
  TallyNotRunningError,
} from '../src/transport.js';

const servers: Server[] = [];

function serve(handler: (body: string) => { status?: number; body: Buffer | string }) {
  return new Promise<string>((resolve) => {
    const srv = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const out = handler(data);
        res.writeHead(out.status ?? 200, { 'Content-Type': 'text/xml' });
        res.end(out.body);
      });
    });
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

afterAll(() => servers.forEach((s) => s.close()));

describe('postXml', () => {
  it('returns sanitized body on success', async () => {
    const url = await serve(() => ({ body: '<ENVELOPE>ok&#4;</ENVELOPE>' }));
    expect(await postXml(url, '<req/>')).toBe('<ENVELOPE>ok</ENVELOPE>');
  });

  it('decodes UTF-16LE responses', async () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<ENVELOPE>utf16</ENVELOPE>', 'utf16le'),
    ]);
    const url = await serve(() => ({ body: utf16 }));
    expect(await postXml(url, '<req/>')).toBe('<ENVELOPE>utf16</ENVELOPE>');
  });

  it('throws TallyGatewayError on LINEERROR', async () => {
    const url = await serve(() => ({
      body: '<ENVELOPE><LINEERROR>Could not find Report</LINEERROR></ENVELOPE>',
    }));
    await expect(postXml(url, '<req/>')).rejects.toThrow(TallyGatewayError);
    await expect(postXml(url, '<req/>')).rejects.toThrow(/Could not find Report/);
  });

  it('throws TallyGatewayError on empty body', async () => {
    const url = await serve(() => ({ body: '' }));
    await expect(postXml(url, '<req/>')).rejects.toThrow(TallyGatewayError);
  });

  it('throws TallyNotRunningError when connection is refused', async () => {
    // Grab a genuinely free port by binding then immediately closing.
    const port = await new Promise<number>((resolve) => {
      const srv = createServer();
      srv.listen(0, '127.0.0.1', () => {
        const p = (srv.address() as { port: number }).port;
        srv.close(() => resolve(p));
      });
    });
    await expect(postXml(`http://127.0.0.1:${port}`, '<req/>')).rejects.toThrow(
      TallyNotRunningError
    );
  });
});
