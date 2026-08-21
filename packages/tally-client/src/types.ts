export interface TallyClientOptions {
  host?: string;
  port?: number;
  company?: string;
  /** Request timeout in ms. Tally can be slow on large companies. */
  timeoutMs?: number;
}

export interface CompanyInfo {
  name: string;
  /** Books-begin date, Tally format YYYYMMDD when available. */
  startingFrom?: string;
}

export interface VoucherLedgerEntry {
  ledgerName: string;
  amount: number;
  isDeemedPositive: boolean;
}

export interface VoucherInventoryEntry {
  stockItemName: string;
  actualQty: string;
  billedQty: string;
  rate: number;
  amount: number;
}

export interface VoucherJSON {
  masterId: string;
  alterId: number;
  guid: string;
  date: string;
  voucherType: string;
  voucherNumber: string;
  party: string;
  narration: string;
  isCancelled: boolean;
  amount: number;
  ledgerEntries: VoucherLedgerEntry[];
  inventoryEntries: VoucherInventoryEntry[];
}

export interface StockItemJSON {
  masterId: string;
  alterId: number;
  guid: string;
  name: string;
  parent: string;
  baseUnits: string;
  closingQty: number;
  closingRate: number;
  closingValue: number;
  salePrice: number;
  costPrice: number;
}

export interface LedgerJSON {
  masterId: string;
  alterId: number;
  guid: string;
  name: string;
  parent: string;
  gstin: string;
}

export interface VoucherQueryOptions {
  fromDate: Date;
  toDate: Date;
  /** Only vouchers with AlterID strictly greater than this. */
  alterIdAbove?: number;
  /** Restrict to these voucher type names, e.g. ["Sales", "Receipt"]. Unset/empty means no restriction. */
  voucherTypes?: string[];
}
