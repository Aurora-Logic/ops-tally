import { randomUUID } from 'node:crypto';

export type TallyEventName =
  | 'voucher.created'
  | 'voucher.updated'
  | 'voucher.cancelled'
  | 'voucher.snapshot'
  | 'stock.updated'
  | 'stock.snapshot'
  | 'ledger.created'
  | 'ledger.updated'
  | 'ping';

export interface EventEnvelope {
  id: string;
  event: TallyEventName;
  created_at: string;
  company: string;
  install_id: string;
  payload: unknown;
}

export function makeEnvelope(
  event: TallyEventName,
  payload: unknown,
  company: string,
  installId: string
): EventEnvelope {
  return {
    id: `evt_${randomUUID()}`,
    event,
    created_at: new Date().toISOString(),
    company,
    install_id: installId,
    payload,
  };
}

/**
 * Product names carried by a stock event's payload, so the Deliveries tab can
 * show what was actually sent rather than just the bare event type.
 */
export function productNamesFrom(event: string, payload: unknown): string[] | undefined {
  if (event === 'stock.updated') {
    const name = (payload as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? [name] : undefined;
  }
  if (event === 'stock.snapshot') {
    const items = (payload as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) return undefined;
    return items
      .map((item) => (item as { name?: unknown } | null)?.name)
      .filter((name): name is string => typeof name === 'string');
  }
  return undefined;
}
