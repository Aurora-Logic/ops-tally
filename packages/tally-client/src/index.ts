export { TallyClient } from './client.js';
export {
  TallyError,
  TallyNotRunningError,
  TallyBusyError,
  TallyGatewayError,
  postXml,
} from './transport.js';
export { esc, fmtTallyDate, sanitizeXml } from './xml.js';
export { text, attr, textAttr, asArray, parseQty, parseAlterId } from './parse/common.js';
export { extractRate, extractRateFromList, getSalePrice, getCostPrice } from './parse/rates.js';
export { parseVoucher, parseVoucherCollection } from './parse/vouchers.js';
export { parseStockItem, parseStockCollection } from './parse/stock.js';
export { parseLedger, parseLedgerCollection } from './parse/ledgers.js';
export { parseCompanyCollection } from './parse/companies.js';
export { parseSalesRates } from './parse/salesRates.js';
export { buildCompaniesXML } from './queries/companies.js';
export { buildVouchersXML } from './queries/vouchers.js';
export { buildStockItemsXML } from './queries/stockItems.js';
export { buildLedgersXML, buildLedgersFallbackXML } from './queries/ledgers.js';
export { buildSalesRatesXML } from './queries/salesRates.js';
export type {
  TallyClientOptions,
  CompanyInfo,
  VoucherJSON,
  VoucherLedgerEntry,
  VoucherInventoryEntry,
  StockItemJSON,
  LedgerJSON,
  VoucherQueryOptions,
} from './types.js';
