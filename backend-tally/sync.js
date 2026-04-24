const { enqueue } = require('./queue');
const { sendToTally } = require('./bridge');
const { buildSalesOrderXML } = require('./xml/salesOrder');
const { buildInvoiceXML } = require('./xml/invoice');
const { buildDispatchXML } = require('./xml/dispatch');
const { buildCustomerXML } = require('./xml/customer');
const { fetchStockLevels, canFulfill } = require('./xml/stock');

// Maps OPS order items to Tally-ready format.
// OPS items use: quantity, priceAtTimeOfOrder, itemId.item (populated)
// Tally XML builders expect: qty, rate, name, gstRate
function mapItems(items = [], defaultGstRate = 18) {
  return items.map((item) => ({
    name: item.name ?? item.itemId?.item ?? String(item.itemId),
    qty: item.qty ?? item.quantity,
    rate: item.rate ?? item.priceAtTimeOfOrder ?? 0,
    gstRate: item.gstRate ?? defaultGstRate,
  }));
}

async function syncSalesOrder(order) {
  const payload = {
    date: order.orderDate || order.date || new Date(),
    customerName: order.customerName || order.dealer_name,
    items: mapItems(order.items),
  };
  const xml = buildSalesOrderXML(payload);
  return enqueue({ type: 'salesOrder', xml, payload: order, refId: order._id?.toString() });
}

async function syncInvoice(invoice) {
  const payload = {
    date: invoice.orderDate || invoice.date || new Date(),
    customerName: invoice.customerName || invoice.dealer_name,
    items: mapItems(invoice.items),
    isInterState: invoice.isInterState ?? false,
    paymentMode: invoice.paymentMode || 'Credit',
  };
  const xml = buildInvoiceXML(payload);
  return enqueue({ type: 'invoice', xml, payload: invoice, refId: invoice._id?.toString() });
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

  const xml = buildDispatchXML({
    date: order.orderDate || new Date(),
    customerName: order.customerName || order.dealer_name,
    items: mappedItems,
    isInterState,
    paymentMode: order.paymentMode || 'Credit',
    orderRef: order._id?.toString() || order.orderCode || 'N/A',
  });

  return enqueue({ type: 'dispatch', xml, payload: order, refId: order._id?.toString() });
}

async function fetchStock() {
  return fetchStockLevels();
}

module.exports = { syncSalesOrder, syncInvoice, syncCustomer, syncDispatch, fetchStock };
