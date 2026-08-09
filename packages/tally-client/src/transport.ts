import { sanitizeXml } from './xml.js';

export class TallyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Tally's HTTP gateway refused the connection — Tally Prime is not running. */
export class TallyNotRunningError extends TallyError {
  constructor() {
    super('Tally is not running — please open Tally Prime');
  }
}

/** Request timed out — usually a modal/edit screen is open inside Tally. */
export class TallyBusyError extends TallyError {
  constructor() {
    super('Tally did not respond in time — it may be busy or a dialog is open');
  }
}

/** Tally answered but reported an error or returned an unusable body. */
export class TallyGatewayError extends TallyError {}

function findCauseCode(err: unknown): string | undefined {
  let cur: any = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur.code === 'string') return cur.code;
    // AggregateError (e.g. undici trying multiple addresses) carries an errors array.
    if (Array.isArray(cur.errors)) {
      for (const e of cur.errors) {
        if (typeof e?.code === 'string') return e.code;
      }
    }
    cur = cur.cause;
  }
  return undefined;
}

/** Decode a Tally response body, handling the UTF-16LE output Tally sometimes produces. */
function decodeBody(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * POST an XML request to the Tally gateway and return the sanitized response body.
 */
export async function postXml(
  url: string,
  xml: string,
  timeoutMs = 60_000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: xml,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') throw new TallyBusyError();
    if (findCauseCode(err) === 'ECONNREFUSED') throw new TallyNotRunningError();
    throw new TallyGatewayError(`Could not reach Tally: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new TallyGatewayError(`Tally gateway returned HTTP ${res.status}`);
  }

  const body = decodeBody(await res.arrayBuffer());
  if (!body.trim()) {
    throw new TallyGatewayError('Tally returned an empty response');
  }
  if (body.includes('<LINEERROR>')) {
    const m = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/.exec(body);
    throw new TallyGatewayError(`Tally error: ${m ? m[1].trim() : 'unknown LINEERROR'}`);
  }
  return sanitizeXml(body);
}
