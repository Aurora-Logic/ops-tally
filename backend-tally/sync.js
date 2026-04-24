const { enqueue } = require('./queue');
const { sendToTally } = require('./bridge');
const { buildSalesOrderXML } = require('./xml/salesOrder');
const { buildInvoiceXML } = require('./xml/invoice');
const { buildDispatchXML } = require('./xml/dispatch');
const { buildCustomerXML } = require('./xml/customer');
const { buildCancellationXML } = require('./xml/cancel');
const { fetchStockLevels, canFulfill } = require('./xml/stock');

// Fix 4: gstRate now flows from the item — no more hardcoded 18%.
// Callers should set item.gstRate from the Product model. Falls back to 18 only if missing.
function mapItems(items = [], defaultGstRate = 18) {
  return items.map((item) => ({
    name: item.name ?? item.itemId?.item ?? String(item.itemId),
    qty: item.qty ?? item.quantity,
    rate: item.rate ?? item.priceAtTimeOfOrder ?? 0,
    gstRate: item.gstRate ?? defaultGstRate,
  }));
}

// Fix 3: refId passed into XML builder so it appears in NARRATION.
// This allows the TDL webhook to match Tally voucher confirmations back to OPS orders.
async function syncSalesOrder(order) {
  const refId = order.refId || order._id?.toString();
  const payload = {
    date: order.orderDate || order.date || new Date(),
    customerName: order.customerName || order.dealer_name,
    items: mapItems(order.items),
    refId,
  };
  const xml = buildSalesOrderXML(payload);
  return enqueue({ type: 'salesOrder', xml, payload: order, refId });
}

async function syncInvoice(invoice) {
  const refId = invoice.refId || invoice._id?.toString();
  const payload = {
    date: invoice.orderDate || invoice.date || new Date(),
    customerName: invoice.customerName || invoice.dealer_name,
    items: mapItems(invoice.items),
    isInterState: invoice.isInterState ?? false,
    paymentMode: invoice.paymentMode || 'Credit',
    refId,
  };
  const xml = buildInvoiceXML(payload);
  return enqueue({ type: 'invoice', xml, payload: invoice, refId });
}

async function syncCustomer(dealer) {
  const address = dealer.dealer_addresses?.[0]
    ? [
        dealer.dealer_addresses[0].addressLine1,
        dealer.dealer_addresses[0].city,
        dealer.dealer_addresses[0].state,
      ].filter(Boolean).join(', ')
    : '';

  const xml = buildCustomerXML({
    name: dealer.dealer_name,
    phone: Array.isArray(dealer.dealer_phone) ? dealer.dealer_phone[0] : dealer.dealer_phone,
    email: dealer.email || null,
    address,
    gstin: dealer.dealer_gstNo || null,
  });
  return enqueue({ type: 'customer', xml, payload: dealer, refId: dealer._id?.toString() });
}

async function syncDispatch({ order, isInterState = false }) {
  const mappedItems = mapItems(order.items);
  const stock = await canFulfill(mappedItems);
  if (!stock.ok) {
    throw Object.assign(new Error('Insufficient stock for dispatch'), { shortfalls: stock.shortfalls });
  }

  const refId = order.refId || order._id?.toString() || order.orderCode;
  const xml = buildDispatchXML({
    date: order.orderDate || new Date(),
    customerName: order.customerName || order.dealer_name,
    items: mappedItems,
    isInterState,
    paymentMode: order.paymentMode || 'Credit',
    orderRef: refId,
    refId,
  });

  return enqueue({ type: 'dispatch', xml, payload: order, refId });
}

// Fix 5: Creates a Credit Note in Tally when an OPS order is cancelled.
// Called from the order controller when shipmentStatus transitions to 'Cancelled'.
async function syncCancellation(order) {
  const refId = order.refId || order._id?.toString();
  const xml = buildCancellationXML({
    date: new Date(),
    customerName: order.customerName || order.dealer_name || 'Unknown',
    items: mapItems(order.items),
    isInterState: order.isInterState ?? false,
    refId,
  });
  return enqueue({ type: 'cancellation', xml, payload: order, refId });
}

async function fetchStock() {
  return fetchStockLevels();
}

module.exports = { syncSalesOrder, syncInvoice, syncCustomer, syncDispatch, syncCancellation, fetchStock };
