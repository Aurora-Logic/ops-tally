import Store from 'electron-store';
import { safeStorage } from 'electron';
import { z } from 'zod';
import { generateSecret } from './dispatcher/signer.js';

const configSchema = z.object({
  webhookUrl: z.string().default(''),
  /** safeStorage-encrypted secret, base64. Plaintext fallback when DPAPI unavailable. */
  secretEncrypted: z.string().default(''),
  secretPlain: z.string().default(''),
  tallyHost: z.string().default('localhost'),
  tallyPort: z.number().int().min(1).max(65535).default(9000),
  company: z.string().default(''),
  /*
   * Vouchers default to 15 minutes, not 2. A voucher poll is now one request
   * per financial year of the company's history (Tally cannot scope a voucher
   * collection more finely than a year), and each year costs Tally real scan
   * time even when the AlterID filter matches nothing — measured at ~9s on a
   * company with eight years of books, so a sweep is over a minute of work.
   * At two minutes Tally would spend most of its life answering us.
   */
  intervalsMinutes: z
    .object({
      vouchers: z.number().min(1).default(15),
      stock: z.number().min(1).default(10),
      ledgers: z.number().min(1).default(30),
    })
    .default({ vouchers: 15, stock: 10, ledgers: 30 }),
  /** Only these voucher types are fetched from Tally at all — filtered in the TDL query itself. */
  voucherTypes: z
    .array(z.string())
    .default(['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Credit Note', 'Debit Note']),
  paused: z.boolean().default(false),
  openAtLogin: z.boolean().default(true),
});

export type AgentConfig = z.infer<typeof configSchema>;

/** Config safe to hand to the renderer — never contains the secret. */
export type PublicConfig = Omit<AgentConfig, 'secretEncrypted' | 'secretPlain'>;

const store = new Store<AgentConfig>({ name: 'opstally-config' });

export function getConfig(): AgentConfig {
  return configSchema.parse(store.store);
}

export function getPublicConfig(): PublicConfig {
  const { secretEncrypted, secretPlain, ...rest } = getConfig();
  return rest;
}

export function updateConfig(patch: Partial<PublicConfig>): PublicConfig {
  const merged = configSchema.parse({ ...store.store, ...patch });
  store.set(merged);
  return getPublicConfig();
}

export function getSecret(): string {
  const cfg = getConfig();
  if (cfg.secretEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(cfg.secretEncrypted, 'base64'));
    } catch {
      return '';
    }
  }
  return cfg.secretPlain;
}

export function setSecret(secret: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    store.set('secretEncrypted', safeStorage.encryptString(secret).toString('base64'));
    store.set('secretPlain', '');
  } else {
    store.set('secretPlain', secret);
    store.set('secretEncrypted', '');
  }
}

/** Returns the existing secret, minting one on first access. */
export function ensureSecret(): string {
  let secret = getSecret();
  if (!secret) {
    secret = generateSecret();
    setSecret(secret);
  }
  return secret;
}

export function regenerateSecret(): string {
  const secret = generateSecret();
  setSecret(secret);
  return secret;
}
