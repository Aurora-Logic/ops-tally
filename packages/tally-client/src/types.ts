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

export interface VoucherTypeInfo {
  name: string;
  parent?: string;
}

/**
 * How a bank line was settled. Present only on the bank ledger's entry of a
 * Receipt/Payment/Contra — Tally nests it under the ledger entry, not the
 * voucher, so a voucher's "payment type" is really a property of one of its
 * lines. Undefined on every non-bank line.
 */
export interface VoucherBankAllocation {
  /** "Cheque/DD", "Inter Bank Transfer", "e-Fund Transfer", … — the payment type. */
  transactionType: string;
  /** Tally's own settlement state, e.g. "Transacted". */
  paymentMode: string;
  instrumentNumber: string;
  /** Tally's native YYYYMMDD, empty when unset. */
  instrumentDate: string;
  bankName: string;
  paymentFavouring: string;
}

export interface VoucherLedgerEntry {
  ledgerName: string;
  amount: number;
  isDeemedPositive: boolean;
  /** Set only on a bank line that carries settlement detail. */
  bankAllocation?: VoucherBankAllocation;
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

  /*
   * Order, terms, dispatch and consignee detail. Every field below is optional
   * in practice — Tally exposes them all, but which ones carry data is entirely
   * a question of how a given company does data entry. Two real companies
   * measured for this: one fills Reference/BasicOrderRef/terms heavily and
   * never touches the dispatch fields; the other is the exact inverse. Treat an
   * empty string as "this company does not record that", not as an error.
   */

  /** Ref field. Commonly holds the buyer's own document number. */
  reference: string;
  /** Tally's native YYYYMMDD, empty when unset. */
  referenceDate: string;
  /** Order reference free text. */
  orderRef: string;
  /** Buyer's Order No, from the order details screen. */
  buyerOrderNumber: string;
  buyerOrderDate: string;
  /** Terms of payment, free text — e.g. "100% Advance Payment". */
  paymentTerms: string;
  /** Terms of delivery, one entry per line as Tally stores them. */
  deliveryTerms: string[];
  /** Dispatched through — carrier or person. */
  dispatchedThrough: string;
  /** Dispatch document number. */
  dispatchDocNo: string;
  /** Vessel/vehicle number. Companies commonly use this for the vehicle. */
  vehicleNumber: string;
  /** Final destination. */
  destination: string;
  buyerName: string;
  /** Buyer's address, one entry per line, in Tally's own order. */
  buyerAddress: string[];
  partyMailingName: string;
  partyGstin: string;
  partyState: string;
  partyCountry: string;
  /** GST place of supply. */
  placeOfSupply: string;
  consigneeName: string;
  consigneeState: string;
  /** String, not a number — a postal code's leading zero is part of it. */
  consigneePincode: string;
  consigneeGstin: string;
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
  /** GST registration type, e.g. "Regular", "Composition", "Unregistered", "Consumer". */
  gstRegistrationType: string;
  /**
   * Opening balance in Tally's sign convention: debit positive, credit
   * negative. For a Sundry Debtor a positive figure is money owed to you.
   */
  openingBalance: number;
  /**
   * Balance as of now — the party's outstanding. Tally computes this from the
   * vouchers, so it moves WITHOUT the ledger's AlterID moving (same trap as
   * stock's closing quantity).
   */
  closingBalance: number;
  /** Mailing address lines in Tally's own order. */
  address: string[];
  state: string;
  country: string;
  pincode: string;
  contactPerson: string;
  phone: string;
  mobile: string;
  email: string;
  /** Credit limit; 0 when unset. */
  creditLimit: number;
  /** Credit period in days; 0 when unset. */
  creditPeriodDays: number;
  /** Bill-by-bill tracking enabled on this ledger. */
  isBillWiseOn: boolean;
}

export interface VoucherQueryOptions {
  fromDate: Date;
  toDate: Date;
  /** Only vouchers with AlterID strictly greater than this. */
  alterIdAbove?: number;
  /** Restrict to these voucher type names, e.g. ["Sales", "Receipt"]. Unset/empty means no restriction. */
  voucherTypes?: string[];
}
