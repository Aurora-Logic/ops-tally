import { asArray, parseAlterId, parseAmount, text, textAttr } from './common.js';
import { extractRate } from './rates.js';
import type {
  VoucherJSON,
  VoucherBankAllocation,
  VoucherInventoryEntry,
  VoucherLedgerEntry,
} from '../types.js';

/** First non-empty of the given field names — absorbs Tally build-to-build renames. */
function firstOf(v: any, ...names: string[]): string {
  for (const name of names) {
    const value = textAttr(v, name);
    if (value) return value;
  }
  return '';
}

/**
 * A Tally "simple list": <FOO.LIST><FOO>line</FOO></FOO.LIST>. A single-entry
 * list can arrive as a bare <FOO> node instead, so both shapes are accepted.
 */
function lines(v: any, name: string): string[] {
  const list = v?.[`${name}.LIST`];
  const raw = list ? (list[name] ?? list) : v?.[name];
  return asArray(raw)
    .map((line) => text(line).trim())
    .filter(Boolean);
}

/**
 * Bank settlement detail on one ledger line. Tally nests this under the bank
 * ledger's entry, so it exists on Receipt/Payment/Contra lines and nowhere
 * else — undefined is the normal answer for an ordinary ledger line.
 */
function parseBankAllocation(entry: any): VoucherBankAllocation | undefined {
  const list = entry?.['BANKALLOCATIONS.LIST'];
  const first = asArray(list?.BANKALLOCATIONS ?? list)[0];
  if (!first || typeof first !== 'object') return undefined;

  const allocation: VoucherBankAllocation = {
    transactionType: textAttr(first, 'TRANSACTIONTYPE'),
    paymentMode: textAttr(first, 'PAYMENTMODE'),
    instrumentNumber: textAttr(first, 'INSTRUMENTNUMBER'),
    instrumentDate: textAttr(first, 'INSTRUMENTDATE'),
    bankName: firstOf(first, 'BANKNAME', 'BANKPARTYNAME'),
    paymentFavouring: textAttr(first, 'PAYMENTFAVOURING'),
  };
  // An allocation node with nothing in it is noise, not a settlement.
  return Object.values(allocation).some((value) => value !== '') ? allocation : undefined;
}

export function parseVoucher(v: any): VoucherJSON {
  // AllLedgerEntries is the reliable one: LedgerEntries comes back empty on
  // Receipt vouchers, and only AllLedgerEntries carries the bank allocation.
  const ledgerRaw = v['ALLLEDGERENTRIES.LIST'] ?? v['LEDGERENTRIES.LIST'];
  const ledgerEntries: VoucherLedgerEntry[] = asArray(ledgerRaw)
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const bankAllocation = parseBankAllocation(e);
      return {
        ledgerName: textAttr(e, 'LEDGERNAME'),
        amount: parseAmount(textAttr(e, 'AMOUNT')),
        isDeemedPositive: textAttr(e, 'ISDEEMEDPOSITIVE').toLowerCase() === 'yes',
        ...(bankAllocation === undefined ? {} : { bankAllocation }),
      };
    });

  const invRaw = v['ALLINVENTORYENTRIES.LIST'] ?? v['INVENTORYENTRIES.LIST'];
  const inventoryEntries: VoucherInventoryEntry[] = asArray(invRaw)
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      stockItemName: textAttr(e, 'STOCKITEMNAME'),
      actualQty: textAttr(e, 'ACTUALQTY'),
      billedQty: textAttr(e, 'BILLEDQTY'),
      rate: extractRate(e.RATE || (e.$ && e.$.RATE)),
      amount: parseAmount(textAttr(e, 'AMOUNT')),
    }));

  return {
    masterId: textAttr(v, 'MASTERID'),
    alterId: parseAlterId(v.ALTERID ?? (v.$ && v.$.ALTERID)),
    guid: textAttr(v, 'GUID'),
    date: textAttr(v, 'DATE'),
    voucherType: textAttr(v, 'VOUCHERTYPENAME') || (v.$ && v.$.VCHTYPE) || '',
    voucherNumber: textAttr(v, 'VOUCHERNUMBER') || textAttr(v, 'VCHNO'),
    party: textAttr(v, 'PARTYLEDGERNAME') || textAttr(v, 'PARTYNAME'),
    narration: textAttr(v, 'NARRATION'),
    isCancelled: textAttr(v, 'ISCANCELLED').toLowerCase() === 'yes',
    amount: parseAmount(textAttr(v, 'AMOUNT')),
    ledgerEntries,
    inventoryEntries,

    // Order / reference.
    reference: textAttr(v, 'REFERENCE'),
    referenceDate: textAttr(v, 'REFERENCEDATE'),
    orderRef: textAttr(v, 'BASICORDERREF'),
    buyerOrderNumber: textAttr(v, 'BASICPURCHASEORDERNO'),
    buyerOrderDate: textAttr(v, 'BASICORDERDATE'),

    // Terms.
    paymentTerms: textAttr(v, 'BASICDUEDATEOFPYMT'),
    deliveryTerms: lines(v, 'BASICORDERTERMS'),

    // Dispatch.
    dispatchedThrough: textAttr(v, 'BASICSHIPPEDBY'),
    dispatchDocNo: textAttr(v, 'BASICSHIPDOCUMENTNO'),
    vehicleNumber: firstOf(v, 'BASICSHIPVESSELNO', 'VEHICLENUMBER'),
    destination: firstOf(v, 'BASICFINALDESTINATION', 'BASICDESTINATION'),

    // Buyer / party.
    buyerName: textAttr(v, 'BASICBUYERNAME'),
    buyerAddress: lines(v, 'BASICBUYERADDRESS'),
    partyMailingName: textAttr(v, 'PARTYMAILINGNAME'),
    partyGstin: firstOf(v, 'PARTYGSTIN', 'PARTYGSTREGISTRATIONNO'),
    partyState: firstOf(v, 'STATENAME', 'PARTYSTATENAME'),
    partyCountry: textAttr(v, 'COUNTRYOFRESIDENCE'),
    placeOfSupply: textAttr(v, 'PLACEOFSUPPLY'),

    // Consignee.
    consigneeName: textAttr(v, 'CONSIGNEEMAILINGNAME'),
    consigneeState: textAttr(v, 'CONSIGNEESTATENAME'),
    consigneePincode: textAttr(v, 'CONSIGNEEPINCODE'),
    consigneeGstin: textAttr(v, 'CONSIGNEEGSTIN'),
  };
}

export function parseVoucherCollection(parsed: any): VoucherJSON[] {
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.VOUCHER) return [];
  return asArray(collection.VOUCHER).map(parseVoucher);
}
