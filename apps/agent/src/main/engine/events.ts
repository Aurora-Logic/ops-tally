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
