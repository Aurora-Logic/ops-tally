import type { VoucherJSON } from '@opstally/tally-client';

/**
 * A complete VoucherJSON for tests.
 *
 * The order/terms/dispatch/consignee fields are required on the type rather
 * than optional, because the parser always sets them — empty string or empty
 * array when Tally reports nothing. That keeps "this company does not record
 * that" and "this field does not exist" as the same, single answer for a
 * consumer, instead of making every reader handle undefined. The cost is that
 * tests have to build a whole voucher, which is what this factory is for.
 */
export function makeVoucher(over: Partial<VoucherJSON> = {}): VoucherJSON {
  return {
    masterId: '501',
    alterId: 100,
    guid: 'g-501',
    date: '20260801',
    voucherType: 'Sales',
    voucherNumber: 'INV-1',
    party: 'Acme',
    narration: '',
    isCancelled: false,
    amount: -100,
    ledgerEntries: [],
    inventoryEntries: [],
    reference: '',
    referenceDate: '',
    orderRef: '',
    buyerOrderNumber: '',
    buyerOrderDate: '',
    paymentTerms: '',
    deliveryTerms: [],
    dispatchedThrough: '',
    dispatchDocNo: '',
    vehicleNumber: '',
    destination: '',
    buyerName: '',
    buyerAddress: [],
    partyMailingName: '',
    partyGstin: '',
    partyState: '',
    partyCountry: '',
    placeOfSupply: '',
    consigneeName: '',
    consigneeState: '',
    consigneePincode: '',
    consigneeGstin: '',
    ...over,
  };
}
