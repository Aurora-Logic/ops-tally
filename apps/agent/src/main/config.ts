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
  intervalsMinutes: z
    .object({
      vouchers: z.number().min(1).default(2),
      stock: z.number().min(1).default(10),
      ledgers: z.number().min(1).default(30),
    })
    .default({ vouchers: 2, stock: 10, ledgers: 30 }),
  voucherLookbackDays: z.number().min(1).max(3650).default(90),
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
