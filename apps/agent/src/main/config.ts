import Store from 'electron-store';
import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generateSecret } from './dispatcher/signer.js';

export const intervalsSchema = z.object({
  vouchers: z.number().min(1).default(15),
  stock: z.number().min(1).default(10),
  ledgers: z.number().min(1).default(30),
});

export const companyProfileSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  enabled: z.boolean().default(true),
  webhookUrl: z.string().default(''),
  secretEncrypted: z.string().default(''),
  secretPlain: z.string().default(''),
  intervalsMinutes: intervalsSchema.default({ vouchers: 15, stock: 10, ledgers: 30 }),
  voucherTypes: z
    .array(z.string())
    .default(['Sales', 'GST SALES', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Credit Note', 'Debit Note']),
});

export type CompanyProfile = z.infer<typeof companyProfileSchema>;
export type PublicCompanyProfile = Omit<CompanyProfile, 'secretEncrypted' | 'secretPlain'>;

export const configSchema = z.object({
  tallyHost: z.string().default('localhost'),
  tallyPort: z.number().int().min(1).max(65535).default(9000),
  activeCompanyId: z.string().default(''),
  companies: z.array(companyProfileSchema).default([]),
  paused: z.boolean().default(false),
  openAtLogin: z.boolean().default(true),

  // Legacy flat fields for automatic migration
  webhookUrl: z.string().optional(),
  secretEncrypted: z.string().optional(),
  secretPlain: z.string().optional(),
  company: z.string().optional(),
  intervalsMinutes: intervalsSchema.optional(),
  voucherTypes: z.array(z.string()).optional(),
});

export type AgentConfig = z.infer<typeof configSchema>;

export interface PublicConfig {
  tallyHost: string;
  tallyPort: number;
  activeCompanyId: string;
  companies: PublicCompanyProfile[];
  paused: boolean;
  openAtLogin: boolean;

  // Active company convenience fields for backwards-compatibility with existing UI
  activeCompany?: PublicCompanyProfile;
  company: string;
  webhookUrl: string;
  intervalsMinutes: z.infer<typeof intervalsSchema>;
  voucherTypes: string[];
}

const store = new Store<Record<string, any>>({ name: 'opstally-config' });

function decryptSecret(encrypted: string, plain: string): string {
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return '';
    }
  }
  return plain;
}

function encryptSecret(secret: string): { secretEncrypted: string; secretPlain: string } {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      secretEncrypted: safeStorage.encryptString(secret).toString('base64'),
      secretPlain: '',
    };
  }
  return {
    secretEncrypted: '',
    secretPlain: secret,
  };
}

/** Reads config, migrating legacy flat structure if needed. */
export function getConfig(): AgentConfig {
  const raw = (store.store ?? {}) as Partial<AgentConfig>;
  let companies = Array.isArray(raw.companies) ? [...raw.companies] : [];

  // Migration: If no companies array exists, migrate flat fields into a primary company profile
  if (companies.length === 0) {
    const defaultId = randomUUID();
    let initialSecretEnc = raw.secretEncrypted ?? '';
    let initialSecretPlain = raw.secretPlain ?? '';
    if (!initialSecretEnc && !initialSecretPlain) {
      const generated = encryptSecret(generateSecret());
      initialSecretEnc = generated.secretEncrypted;
      initialSecretPlain = generated.secretPlain;
    }

    const defaultProfile: CompanyProfile = {
      id: defaultId,
      name: raw.company ?? '',
      enabled: true,
      webhookUrl: raw.webhookUrl ?? '',
      secretEncrypted: initialSecretEnc,
      secretPlain: initialSecretPlain,
      intervalsMinutes: raw.intervalsMinutes ?? { vouchers: 15, stock: 10, ledgers: 30 },
      voucherTypes: raw.voucherTypes ?? ['Sales', 'GST SALES', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Credit Note', 'Debit Note'],
    };

    companies = [defaultProfile];
    store.set('companies', companies);
    store.set('activeCompanyId', defaultId);
  }

  let activeCompanyId = raw.activeCompanyId;
  if (!activeCompanyId || !companies.some((c) => c.id === activeCompanyId)) {
    activeCompanyId = companies[0]?.id ?? '';
    store.set('activeCompanyId', activeCompanyId);
  }

  return configSchema.parse({
    ...raw,
    companies,
    activeCompanyId,
  });
}

export function getPublicConfig(): PublicConfig {
  const cfg = getConfig();
  const publicCompanies: PublicCompanyProfile[] = cfg.companies.map(({ secretEncrypted, secretPlain, ...rest }) => rest);
  const active = publicCompanies.find((c) => c.id === cfg.activeCompanyId) ?? publicCompanies[0];

  return {
    tallyHost: cfg.tallyHost,
    tallyPort: cfg.tallyPort,
    activeCompanyId: cfg.activeCompanyId,
    companies: publicCompanies,
    paused: cfg.paused,
    openAtLogin: cfg.openAtLogin,

    activeCompany: active,
    company: active?.name ?? '',
    webhookUrl: active?.webhookUrl ?? '',
    intervalsMinutes: active?.intervalsMinutes ?? { vouchers: 15, stock: 10, ledgers: 30 },
    voucherTypes: active?.voucherTypes ?? ['Sales', 'GST SALES', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Credit Note', 'Debit Note'],
  };
}

export function updateConfig(patch: Partial<PublicConfig>): PublicConfig {
  const current = getConfig();
  let nextCompanies = patch.companies
    ? current.companies.map((c) => {
        const p = patch.companies?.find((item) => item.id === c.id);
        return p ? { ...c, ...p } : c;
      })
    : current.companies;

  // If patching flat fields like company or webhookUrl, apply to active company
  const targetActiveId = patch.activeCompanyId ?? current.activeCompanyId;
  const activeIndex = nextCompanies.findIndex((c) => c.id === targetActiveId);
  if (activeIndex >= 0) {
    const active = nextCompanies[activeIndex];
    nextCompanies = nextCompanies.map((c, i) =>
      i === activeIndex
        ? {
            ...active,
            ...(patch.company !== undefined ? { name: patch.company } : {}),
            ...(patch.webhookUrl !== undefined ? { webhookUrl: patch.webhookUrl } : {}),
            ...(patch.intervalsMinutes !== undefined ? { intervalsMinutes: patch.intervalsMinutes } : {}),
            ...(patch.voucherTypes !== undefined ? { voucherTypes: patch.voucherTypes } : {}),
          }
        : c
    );
  }

  const updated = {
    ...current,
    ...patch,
    companies: nextCompanies,
  };

  store.set(updated);
  return getPublicConfig();
}

export function getCompanySecret(companyId?: string): string {
  const cfg = getConfig();
  const targetId = companyId || cfg.activeCompanyId;
  const company = cfg.companies.find((c) => c.id === targetId) ?? cfg.companies[0];
  if (!company) return '';
  return decryptSecret(company.secretEncrypted, company.secretPlain);
}

export function setCompanySecret(companyId: string, secret: string): void {
  const cfg = getConfig();
  const encrypted = encryptSecret(secret);
  const updatedCompanies = cfg.companies.map((c) =>
    c.id === companyId ? { ...c, ...encrypted } : c
  );
  store.set('companies', updatedCompanies);
}

export function ensureCompanySecret(companyId?: string): string {
  const cfg = getConfig();
  const targetId = companyId || cfg.activeCompanyId;
  let secret = getCompanySecret(targetId);
  if (!secret) {
    secret = generateSecret();
    setCompanySecret(targetId, secret);
  }
  return secret;
}

export function regenerateCompanySecret(companyId?: string): string {
  const cfg = getConfig();
  const targetId = companyId || cfg.activeCompanyId;
  const secret = generateSecret();
  setCompanySecret(targetId, secret);
  return secret;
}

export function addCompany(name = ''): PublicCompanyProfile {
  const cfg = getConfig();
  const newId = randomUUID();
  const generated = encryptSecret(generateSecret());
  const newProfile: CompanyProfile = {
    id: newId,
    name,
    enabled: true,
    webhookUrl: '',
    secretEncrypted: generated.secretEncrypted,
    secretPlain: generated.secretPlain,
    intervalsMinutes: { vouchers: 15, stock: 10, ledgers: 30 },
    voucherTypes: ['Sales', 'GST SALES', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Credit Note', 'Debit Note'],
  };

  const companies = [...cfg.companies, newProfile];
  store.set('companies', companies);
  store.set('activeCompanyId', newId);

  const { secretEncrypted, secretPlain, ...pub } = newProfile;
  return pub;
}

export function removeCompany(companyId: string): boolean {
  const cfg = getConfig();
  if (cfg.companies.length <= 1) {
    // Keep at least one company
    return false;
  }
  const companies = cfg.companies.filter((c) => c.id !== companyId);
  const activeCompanyId = cfg.activeCompanyId === companyId ? (companies[0]?.id ?? '') : cfg.activeCompanyId;
  store.set('companies', companies);
  store.set('activeCompanyId', activeCompanyId);
  return true;
}

// Backwards-compatible legacy helpers:
export function getSecret(): string {
  return getCompanySecret();
}

export function setSecret(secret: string): void {
  const cfg = getConfig();
  setCompanySecret(cfg.activeCompanyId, secret);
}

export function ensureSecret(): string {
  return ensureCompanySecret();
}

export function regenerateSecret(): string {
  return regenerateCompanySecret();
}
