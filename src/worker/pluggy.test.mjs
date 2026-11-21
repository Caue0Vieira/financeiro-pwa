import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { bankNameFor, invoiceMonthFor, mapTransaction, purchasesAreNegative, saoPauloDate, spreadInstallments } from './mapping.ts';

test('Meu Pluggy connections take the bank name from their accounts', () => {
  assert.equal(bankNameFor('Banco Inter', []), 'Banco Inter');
  assert.equal(bankNameFor('MeuPluggy', [{ name: 'Conta Corrente' }, { name: 'Cartão', marketingName: 'Inter Prime' }]), 'Banco Inter');
  assert.equal(bankNameFor('Meu Pluggy', [{ name: 'NU PAGAMENTOS S.A.' }]), 'Nubank');
  assert.equal(bankNameFor('MeuPluggy', [{ name: 'Conta' }]), 'Meu Pluggy');
});
import { validSignature, validToken } from './pluggy.ts';

test('the custom header token must match exactly and be long enough', () => {
  const secret = 'f'.repeat(64);
  assert.equal(validToken(secret, secret), true);
  assert.equal(validToken(` ${secret} `, secret), true);
  assert.equal(validToken('f'.repeat(63), secret), false);
  assert.equal(validToken(null, secret), false);
  assert.equal(validToken('short', 'short'), false);
  assert.equal(validToken('', ''), false);
});

const noCategory = () => '';
const card = { type: 'CREDIT' };
const bank = { type: 'BANK' };
const context = { closingDay: 3, dueDay: 10, purchasesNegative: false, categorize: noCategory };

test('dates are kept as the São Paulo calendar day', () => {
  assert.equal(saoPauloDate('2026-11-18T02:30:00.000Z'), '2026-11-17');
  assert.equal(saoPauloDate('2026-11-18T15:00:00.000Z'), '2026-11-18');
  assert.equal(saoPauloDate('2026-11-18'), '2026-11-18');
});

test('purchases go to the invoice of the right month', () => {
  // closes 3, due 10: on/before the 3rd → this month; after → next month
  assert.equal(invoiceMonthFor('2026-11-03', 3, 10), '2026-11-01');
  assert.equal(invoiceMonthFor('2026-11-04', 3, 10), '2026-12-01');
  // closes 28, due 5 (closes the month before the due month)
  assert.equal(invoiceMonthFor('2026-11-20', 28, 5), '2026-12-01');
  assert.equal(invoiceMonthFor('2026-11-29', 28, 5), '2027-01-01');
  assert.equal(invoiceMonthFor('2026-11-29', null, 5), null);
});

test('card purchases become expenses; refunds stay positive; bill payments are skipped', () => {
  const purchase = mapTransaction({ id: 'a', date: '2026-11-05T12:00:00Z', description: 'MERCADO X', amount: 75, category: 'Groceries' }, card, context);
  assert.deepEqual(
    { amount: purchase.amount_cents, kind: purchase.kind, category: purchase.category, invoice: purchase.invoice_month, source: purchase.source, id: purchase.external_id },
    { amount: -7500, kind: 'expense', category: 'Mercado', invoice: '2026-12-01', source: 'pluggy', id: 'a' },
  );
  const refund = mapTransaction({ id: 'b', date: '2026-11-06T12:00:00Z', description: 'ESTORNO LOJA', amount: -20 }, card, context);
  assert.equal(refund.kind, 'refund');
  assert.equal(refund.amount_cents, 2000);
  assert.equal(mapTransaction({ id: 'c', date: '2026-11-10T12:00:00Z', description: 'PAGAMENTO DE FATURA', amount: -500 }, card, context), null);
  // Open-invoice purchases arrive PENDING and are imported; future installments are not.
  const open = mapTransaction({ id: 'd', date: '2026-11-10T12:00:00Z', description: 'LOJA', amount: 10, status: 'PENDING' }, card, { ...context, today: '2026-11-20' });
  assert.deepEqual([open.kind, open.amount_cents, open.status], ['expense', -1000, 'confirmed']);
  assert.equal(mapTransaction({ id: 'e', date: '2026-12-10T12:00:00Z', description: 'LOJA 2/3', amount: 10, status: 'PENDING' }, card, { ...context, today: '2026-11-20' }), null);
  assert.equal(mapTransaction({ id: 'g', date: '2026-11-10', description: 'PIX', amount: -10, status: 'PENDING' }, bank, context), null);
});

test('savings pots, own transfers and yields are not counted as spending or income', () => {
  const owned = { type: 'BANK', owner: 'CAUE TESTE SILVA' };
  const kindOf = (tx) => {
    const row = mapTransaction({ id: 'x', date: '2026-11-16', ...tx }, owned, context);
    return [row.kind, row.category];
  };
  assert.deepEqual(kindOf({ description: 'Dinheiro reservado Cofrinho da virada', amount: -5000, category: 'Transfer - Internal' }), ['transfer', 'Cofrinho']);
  assert.deepEqual(kindOf({ description: 'Dinheiro retirado Casa', amount: 5006.36, category: 'Transfer - Internal' }), ['transfer', 'Cofrinho']);
  assert.deepEqual(kindOf({ description: 'Dinheiro reservado', amount: 5000, category: 'Investments' }), ['transfer', 'Cofrinho']);
  assert.deepEqual(kindOf({ description: 'Pix recebido - 5360 Caue Teste Silva', amount: 414.46, category: 'Transfer - PIX' }), ['transfer', 'Transferências']);
  assert.deepEqual(kindOf({ description: 'Pix enviado - Fulano', amount: -10, category: 'Same person transfer - PIX' }), ['transfer', 'Transferências']);
  assert.deepEqual(kindOf({ description: 'Rendimentos', amount: 2.52, category: 'Proceeds interests and dividends' }), ['income', 'Rendimentos']);
  assert.deepEqual(kindOf({ description: 'Pix enviado - Caue Outro', amount: -26.5, category: 'Transfer - PIX' }), ['expense', 'Transferências']);
});

test('accounts that report purchases as negative are detected', () => {
  const sandbox = [
    { id: '1', date: '2026-11-01', description: 'NETFLIX.COM', amount: -55.9 },
    { id: '2', date: '2026-11-02', description: 'UBER', amount: -20 },
    { id: '3', date: '2026-11-03', description: 'PAGAMENTO DE FATURA', amount: 300 },
  ];
  assert.equal(purchasesAreNegative(sandbox), true);
  assert.equal(purchasesAreNegative(sandbox.map((tx) => ({ ...tx, amount: -tx.amount }))), false);
  const row = mapTransaction(sandbox[0], card, { ...context, purchasesNegative: true });
  assert.equal(row.kind, 'expense');
  assert.equal(row.amount_cents, -5590);
});

test('bank transactions keep their sign and recognise card bill payments', () => {
  const salary = mapTransaction({ id: 's', date: '2026-11-05', description: 'SALARIO', amount: 1500, type: 'CREDIT', category: 'Salary' }, bank, context);
  assert.deepEqual([salary.kind, salary.amount_cents, salary.category, salary.invoice_month], ['income', 150000, 'Salário', null]);
  const pix = mapTransaction({ id: 'p', date: '2026-11-05', description: 'PIX ENVIADO FULANO', amount: -30.5, category: 'Transfer - PIX' }, bank, context);
  assert.deepEqual([pix.kind, pix.amount_cents, pix.category], ['expense', -3050, 'Transferências']);
  const bill = mapTransaction({ id: 'f', date: '2026-11-10', description: 'Pagamento fatura cartão', amount: -500, category: 'Credit card payment' }, bank, context);
  assert.deepEqual([bill.kind, bill.category], ['card_payment', 'Cartão']);
  const taxi = mapTransaction({ id: 't', date: '2026-11-10', description: 'CORRIDA', amount: -18, category: 'Taxi and ride-hailing' }, bank, context);
  assert.equal(taxi.category, 'Transporte');
});

test('the app categoriser wins over the Pluggy category', () => {
  const row = mapTransaction({ id: 'n', date: '2026-11-05', description: 'NETFLIX', amount: 39.9, category: 'Video streaming' }, card, { ...context, categorize: () => 'Assinaturas' });
  assert.equal(row.category, 'Assinaturas');
});

test('webhook signatures are checked against the raw body and time window', async () => {
  const secret = 'whsec_' + 'a'.repeat(64);
  const body = JSON.stringify({ event: 'transactions/created', itemId: 'x' });
  const t = 1_800_000_000;
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const now = t * 1000;
  assert.equal(await validSignature(`t=${t},v1=${v1}`, body, secret, now), true);
  assert.equal(await validSignature(`t=${t},v1=${v1}`, body + ' ', secret, now), false);
  assert.equal(await validSignature(`t=${t},v1=${v1}`, body, 'whsec_other', now), false);
  assert.equal(await validSignature(`t=${t},v1=${v1}`, body, secret, now + 6 * 60_000), false);
  assert.equal(await validSignature(null, body, secret, now), false);
});

test('installments sent all at once on the purchase date go one per month; monthly ones stay', () => {
  const row = (description, n, count, date, invoice = null) =>
    ({ description, installment_number: n, installment_count: count, occurred_on: date, invoice_month: invoice });
  const duo = [1, 2, 3, 12].map((n) => row('CP PARC DUO GOURMET', n, 12, '2026-11-05'));
  const shop = [row('LOJAS RENNER', 1, 2, '2026-06-09', '2026-07-01'), row('LOJAS RENNER', 2, 2, '2026-07-10', '2026-08-01')];
  const result = spreadInstallments([...duo, ...shop, row('Mercado', null, null, '2026-11-05')]);
  assert.deepEqual(result.slice(0, 4).map((r) => r.occurred_on), ['2026-11-05', '2026-12-05', '2027-01-05', '2027-10-05']);
  assert.deepEqual(result.slice(4, 6), shop);
  assert.deepEqual(spreadInstallments([row('X', 1, 3, '2026-01-31', '2026-02-01'), row('X', 2, 3, '2026-01-31', '2026-02-01')])[1],
    row('X', 2, 3, '2026-02-28', '2026-03-01'));
});
