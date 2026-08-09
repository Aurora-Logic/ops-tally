import { createHmac, randomBytes } from 'node:crypto';

/** Hex HMAC-SHA256 over the exact raw request body — Razorpay-style signature. */
export function signBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** Generate a fresh webhook signing secret with a recognizable prefix. */
export function generateSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}
