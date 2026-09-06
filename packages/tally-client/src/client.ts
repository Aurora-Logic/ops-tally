import { parseStringPromise } from 'xml2js';
import { postXml } from './transport.js';
import { buildCompaniesXML } from './queries/companies.js';
import { buildVouchersXML } from './queries/vouchers.js';
import { buildStockItemsXML } from './queries/stockItems.js';
import { buildLedgersXML } from './queries/ledgers.js';
import { buildVoucherTypesXML } from './queries/voucherTypes.js';
import { buildSalesRatesXML } from './queries/salesRates.js';
import { buildPurchaseRatesXML } from './queries/purchaseRates.js';
import { parseCompanyCollection } from './parse/companies.js';
import { parseVoucherCollection } from './parse/vouchers.js';
import { parseStockCollection } from './parse/stock.js';
import { parseLedgerCollection } from './parse/ledgers.js';
import { parseVoucherTypeCollection } from './parse/voucherTypes.js';
import { parseSalesRates } from './parse/salesRates.js';
import { parsePurchaseRates } from './parse/purchaseRates.js';
import type {
  CompanyInfo,
  LedgerJSON,
  StockItemJSON,
  TallyClientOptions,
  VoucherJSON,
  VoucherQueryOptions,
  VoucherTypeInfo,
} from './types.js';

export class TallyClient {
  host: string;
  port: number;
  company: string;
  timeoutMs: number;

  constructor(opts: TallyClientOptions = {}) {
    this.host = opts.host ?? 'localhost';
    this.port = opts.port ?? 9000;
    this.company = opts.company ?? '';
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  get url(): string {
    const host = this.host === 'localhost' ? '127.0.0.1' : this.host;
    return `http://${host}:${this.port}`;
  }

  private async exec(xml: string): Promise<any> {
    const raw = await postXml(this.url, xml, this.timeoutMs);
    return parseStringPromise(raw, { explicitArray: false });
  }

  /** Cheapest liveness probe: ask for the company list. Throws typed errors. */
  async testConnection(): Promise<CompanyInfo[]> {
    return this.listCompanies();
  }

  async listCompanies(): Promise<CompanyInfo[]> {
    return parseCompanyCollection(await this.exec(buildCompaniesXML()));
  }

  async getVouchers(opts: VoucherQueryOptions): Promise<VoucherJSON[]> {
    return parseVoucherCollection(await this.exec(buildVouchersXML(this.company, opts)));
  }

  async getSalesLastRates(fromDate?: Date): Promise<Map<string, number>> {
    return parseSalesRates(await this.exec(buildSalesRatesXML(this.company, fromDate)));
  }

  async getPurchaseLastRates(fromDate?: Date): Promise<Map<string, number>> {
    return parsePurchaseRates(await this.exec(buildPurchaseRatesXML(this.company, fromDate)));
  }

  /**
   * Stock items with resolved sale/cost prices. Price resolution needs the
   * last-sale-rate and last-purchase-rate maps (the latter is the
   * deterministic cost fallback for fully-sold-out items); pass
   * `withSalePrices: false` to skip both (potentially slow) voucher scans.
   */
  async getStockItems(withSalePrices = true): Promise<StockItemJSON[]> {
    let saleRates = new Map<string, number>();
    let purchaseRates = new Map<string, number>();
    if (withSalePrices) {
      saleRates = await this.getSalesLastRates();
      purchaseRates = await this.getPurchaseLastRates();
    }
    return parseStockCollection(await this.exec(buildStockItemsXML(this.company)), saleRates, purchaseRates);
  }

  async getLedgers(): Promise<LedgerJSON[]> {
    return parseLedgerCollection(await this.exec(buildLedgersXML(this.company)));
  }

  async getVoucherTypes(): Promise<VoucherTypeInfo[]> {
    return parseVoucherTypeCollection(await this.exec(buildVoucherTypesXML(this.company)));
  }
}
