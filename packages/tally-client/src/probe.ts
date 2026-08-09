/**
 * CLI probe against a live Tally instance. Validates the assumptions the
 * change-detection design rests on (MASTERID / ALTERID / GUID presence) and
 * optionally captures raw XML responses as test fixtures.
 *
 *   npm run probe -- --port 9000 [--company "Name"] [--save-fixtures test/fixtures]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStringPromise } from 'xml2js';
import { postXml } from './transport.js';
import { TallyClient } from './client.js';
import { buildCompaniesXML } from './queries/companies.js';
import { buildStockItemsXML } from './queries/stockItems.js';
import { buildLedgersXML } from './queries/ledgers.js';
import { buildVouchersXML } from './queries/vouchers.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const host = arg('host') ?? 'localhost';
  const port = parseInt(arg('port') ?? '9000', 10);
  const fixturesDir = arg('save-fixtures');
  const client = new TallyClient({ host, port });

  const save = (name: string, xml: string) => {
    if (!fixturesDir) return;
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(join(fixturesDir, name), xml, 'utf8');
    console.log(`  saved ${join(fixturesDir, name)}`);
  };

  console.log(`Probing Tally at ${client.url} ...\n`);

  // 1. Companies
  const companiesRaw = await postXml(client.url, buildCompaniesXML());
  save('companies.xml', companiesRaw);
  const companies = (await import('./parse/companies.js')).parseCompanyCollection(
    await parseStringPromise(companiesRaw, { explicitArray: false })
  );
  console.log('Companies loaded in Tally:');
  for (const c of companies) console.log(`  - ${c.name} (books from ${c.startingFrom ?? '?'})`);

  const company = arg('company') ?? companies[0]?.name ?? '';
  if (!company) throw new Error('No company found or specified');
  client.company = company;
  console.log(`\nUsing company: ${company}\n`);

  // 2. Stock items — check change-tracking keys
  const stockRaw = await postXml(client.url, buildStockItemsXML(company));
  save('stock-items.xml', stockRaw);
  const stock = (await import('./parse/stock.js')).parseStockCollection(
    await parseStringPromise(stockRaw, { explicitArray: false })
  );
  const stockMaxAlter = Math.max(0, ...stock.map((s) => s.alterId));
  const stockWithGuid = stock.filter((s) => s.guid).length;
  console.log(`Stock items: ${stock.length}`);
  console.log(`  max AlterID: ${stockMaxAlter}`);
  console.log(`  with GUID: ${stockWithGuid}/${stock.length}`);
  if (stock[0]) console.log('  sample:', JSON.stringify(stock[0], null, 2));

  // 3. Ledgers
  const ledgersRaw = await postXml(client.url, buildLedgersXML(company));
  save('ledgers.xml', ledgersRaw);
  const ledgers = (await import('./parse/ledgers.js')).parseLedgerCollection(
    await parseStringPromise(ledgersRaw, { explicitArray: false })
  );
  const ledgerMaxAlter = Math.max(0, ...ledgers.map((l) => l.alterId));
  console.log(`\nLedgers: ${ledgers.length}`);
  console.log(`  max AlterID: ${ledgerMaxAlter}`);
  console.log(`  with GUID: ${ledgers.filter((l) => l.guid).length}/${ledgers.length}`);

  // 4. Vouchers, last 90 days — the critical ALTERID/GUID check
  const to = new Date();
  const from = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const vouchersRaw = await postXml(
    client.url,
    buildVouchersXML(company, { fromDate: from, toDate: to })
  );
  save('vouchers.xml', vouchersRaw);
  const vouchers = (await import('./parse/vouchers.js')).parseVoucherCollection(
    await parseStringPromise(vouchersRaw, { explicitArray: false })
  );
  const vchMaxAlter = Math.max(0, ...vouchers.map((v) => v.alterId));
  console.log(`\nVouchers (last 90 days): ${vouchers.length}`);
  console.log(`  max AlterID: ${vchMaxAlter}`);
  console.log(`  with MASTERID: ${vouchers.filter((v) => v.masterId).length}/${vouchers.length}`);
  console.log(`  with GUID: ${vouchers.filter((v) => v.guid).length}/${vouchers.length}`);
  if (vouchers[0]) {
    const { ledgerEntries, inventoryEntries, ...head } = vouchers[0];
    console.log('  sample:', JSON.stringify(head, null, 2));
  }

  console.log('\nVerdict:');
  const alterOk = vchMaxAlter > 0 && stockMaxAlter > 0;
  console.log(
    alterOk
      ? '  ALTERID present on vouchers and masters — watermark change detection is viable.'
      : '  WARNING: ALTERID missing or zero — fall back to hash-diff detection.'
  );
}

main().catch((err) => {
  console.error('Probe failed:', err.message);
  process.exit(1);
});
