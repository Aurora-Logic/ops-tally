const STOCK_ITEMS = [
  { NAME: 'Steel Rod 10mm',  CLOSINGBALANCE: 500, BASEUNITS: 'NOS', RATE: 120 },
  { NAME: 'Binding Wire',    CLOSINGBALANCE: 200, BASEUNITS: 'NOS', RATE: 80  },
  { NAME: 'Cement Bag',      CLOSINGBALANCE: 50,  BASEUNITS: 'NOS', RATE: 350 },
];

const CUSTOMERS = [
  {
    NAME: 'Rahul Enterprises',
    LEDPHONE: '9876543210',
    LEDEMAIL: 'rahul@example.com',
    PARTYGSTIN: '27AABCU9603R1ZX',
    OPENINGBALANCE: 0,
  },
  {
    NAME: 'Priya Traders',
    LEDPHONE: '9123456789',
    LEDEMAIL: null,
    PARTYGSTIN: null,
    OPENINGBALANCE: 5000,
  },
];

module.exports = { STOCK_ITEMS, CUSTOMERS };
