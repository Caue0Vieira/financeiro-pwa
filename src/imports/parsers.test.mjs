import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeImportFile, deduplicateFitIds, hasPossibleDuplicate, installmentKey, parseBrazilianAmount, parseInterStatement, parseInvoiceCsv, parseOfx } from './parsers.ts';

test('Inter metadata, signed values, quoted fields and reverse chronological months', () => {
  const result = parseInterStatement('\uFEFFConta ;Conta exemplo\nPeríodo ;01/01/2025 a 28/02/2025\nSaldo ;1.200,00\n\nData Lançamento;Histórico;Descrição;Valor;Saldo\n28/02/2025;Pagamento de fatura;Cartão;-1.000,00;200,00\n03/01/2025;Pix;"Pessoa; teste";50,25;1.200,00\n');
  assert.equal(result.period, '01/01/2025 a 28/02/2025');
  assert.equal(result.transactions[0].kind, 'invoice_payment');
  assert.equal(result.transactions[1].kind, 'review');
  assert.equal(result.transactions[1].description, 'Pix — Pessoa; teste');
  assert.deepEqual(result.months.map(m => m.month), ['2025-01', '2025-02']);
  assert.equal(result.months[1].outflow, 100000);
  assert.equal(result.months[0].inflow, 5025);
});
test('amount and date errors do not silently corrupt values', () => {
  assert.equal(parseBrazilianAmount('-1.000,01'), -100001);
  assert.throws(() => parseBrazilianAmount('1.00,00'));
  assert.throws(() => parseInterStatement('Data Lançamento;Histórico;Descrição;Valor;Saldo\n31/02/2025;Compra;Teste;-1,00;0,00'));
});
test('OFX SGML and XML decode values, require FITID, and deduplicate', () => {
  const result = parseOfx('<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20250115<TRNAMT>-12.34<FITID>abc<NAME>A &amp; B</STMTTRN><STMTTRN><DTPOSTED>20250116</DTPOSTED><TRNAMT>10.00</TRNAMT><FITID>abc</FITID></STMTTRN></BANKTRANLIST></OFX>');
  assert.equal(result.transactions[0].amount, -1234);
  assert.equal(result.transactions[0].description, 'A & B');
  assert.equal(deduplicateFitIds(result.transactions, []).length, 1);
  assert.equal(deduplicateFitIds(result.transactions, ['abc']).length, 0);
  assert.throws(() => parseOfx('<!DOCTYPE OFX [<!ENTITY x SYSTEM "file:///x">]><OFX/>'));
  assert.throws(() => parseOfx('<OFX><STMTTRN><DTPOSTED>20250101<TRNAMT>1.00</STMTTRN></OFX>'));
});
test('invoice mapping and installment identification', () => {
  const invoice = parseInvoiceCsv('Valor;Compra;Data\n"1.234,56";Mercado 02/10;15/01/2025', { date: 2, description: 1, amount: 0 });
  assert.equal(invoice.rows[0].amount, 123456);
  assert.deepEqual(installmentKey(invoice.rows[0].description), { name: 'mercado', installment: 2, total: 10 });
  assert.equal(invoice.rows[0].installmentNumber, 2);
  const separate = parseInvoiceCsv('Data;Compra;Valor;Parcela\n2025-01-15;Tênis;39.90;02 de 06',
    { date: 0, description: 1, amount: 2, installment: 3 });
  assert.deepEqual(
    [separate.rows[0].date, separate.rows[0].amount, separate.rows[0].installmentCount],
    ['2025-01-15', 3990, 6],
  );
  assert.throws(() => parseInvoiceCsv('A;B;C\nx;y;z', { date: 0, description: 0, amount: 2 }));
});
test('detects possible duplicates by account and preserves explicit file encoding', () => {
  const row = { date: '2025-01-15', amount: -1200, description: 'Mercado' };
  const existing = [{ ...row, description: 'MERCADO', accountId: 'a' }];
  assert.equal(hasPossibleDuplicate(row, existing, 'a'), true);
  assert.equal(hasPossibleDuplicate(row, existing, 'b'), false);
  const bytes = Uint8Array.from([0x4d, 0xe9, 0x72, 0x63, 0x61, 0x64, 0x6f]);
  assert.equal(decodeImportFile(bytes.buffer, true), 'Mércado');
  assert.throws(() => decodeImportFile(bytes.buffer, false));
});
