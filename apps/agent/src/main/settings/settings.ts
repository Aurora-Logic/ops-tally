import Store from 'electron-store';
import { z } from 'zod';

/**
 * Global, cross-cutting settings — distinct from `config.ts`'s per-connection
 * settings (webhookUrl, tallyHost, intervals, ...). Stored in its own file so
 * it isn't tied to any one Tally company/connection. Starts with just a
 * license key placeholder; add future global toggles to this schema.
 */
const settingsSchema = z.object({
  license: z
    .object({
      key: z.string().nullable().default(null),
    })
    .default({ key: null }),
});

export type GlobalSettings = z.infer<typeof settingsSchema>;

const store = new Store<GlobalSettings>({ name: 'opstally-settings' });

export function getSettings(): GlobalSettings {
  return settingsSchema.parse(store.store);
}

export function setSettings(patch: Partial<GlobalSettings>): GlobalSettings {
  const merged = settingsSchema.parse({ ...store.store, ...patch });
  store.set(merged);
  return getSettings();
}
