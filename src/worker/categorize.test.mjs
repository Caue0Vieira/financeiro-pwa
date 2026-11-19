import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiRequest, categorizePending, descriptionKey, parseAiAnswer } from './categorize.ts';

test('descriptions are normalised without accents, digits or punctuation', () => {
  assert.equal(descriptionKey('  PADARIA SÃO JOÃO 0231*12/03 '), 'padaria sao joao');
  assert.equal(descriptionKey('Açaí do Zé'), 'acai do ze');
  assert.equal(descriptionKey('UBER *TRIP 2311'), 'uber trip');
});

test('only allowed categories are accepted from the model, matched loosely', () => {
  const categories = ['Mercado', 'Alimentação'];
  const answer = { response: { items: [{ i: 0, category: 'alimentacao' }, { i: 1, category: 'Pets' }, { i: 7, category: 'Mercado' }, { i: 2, category: 'Sem categoria' }] } };
  assert.deepEqual(parseAiAnswer(answer, 3, categories), ['Alimentação', null, 'Sem categoria']);
  assert.deepEqual(parseAiAnswer({ response: 'Aqui está: {"items":[{"i":0,"category":"Mercado"}]}' }, 1, categories), ['Mercado']);
  assert.deepEqual(parseAiAnswer({ response: 'sem json' }, 1, categories), [null]);
  assert.deepEqual(parseAiAnswer(null, 1, categories), [null]);
});

test('the request lists every item, the categories and the learned examples', () => {
  const request = aiRequest([{ description: 'PADARIA X', amount_cents: -1250 }], ['Alimentação'], [['uber trip', 'Transporte']]);
  assert.match(request.messages[0].content, /Alimentação, Sem categoria/);
  assert.match(request.messages[1].content, /0\. PADARIA X \(R\$ 12\.50\)/);
  assert.match(request.messages[1].content, /uber trip → Transporte/);
  assert.equal(request.response_format.type, 'json_schema');
});

/** Tiny stand-in for the Supabase query builder: records filters and updates. */
function fakeDb(pending) {
  const updates = [];
  const from = (table) => {
    const state = { table, filters: [], update: null };
    const builder = {
      select: () => builder,
      eq: (column, value) => (state.filters.push(['eq', column, value]), builder),
      neq: () => builder,
      is: () => builder,
      in: (column, value) => (state.filters.push(['in', column, value]), builder),
      order: () => builder,
      limit: () => builder,
      update: (values) => ((state.update = values), builder),
      then: (resolve) => {
        if (state.update) {
          updates.push({ values: state.update, ids: state.filters.find(([, c]) => c === 'id')[2] });
          return resolve({ error: null });
        }
        if (table === 'category_rules') return resolve({ data: [], error: null });
        const isPending = state.filters.some(([, c, v]) => c === 'category' && v === 'Sem categoria');
        return resolve({ data: isPending ? pending : [{ category: 'Pets' }], error: null });
      },
    };
    return builder;
  };
  return { db: { from }, updates };
}

test('uncategorised expenses get the model answer, unsure ones are marked as asked', async () => {
  const pending = [
    { id: 'a', description: 'PADARIA X', amount_cents: -1000, kind: 'expense' },
    { id: 'b', description: 'PIX JOAO', amount_cents: -5000, kind: 'expense' },
    { id: 'c', description: 'TESOURO DIRETO', amount_cents: -10000, kind: 'expense' },
    { id: 'd', description: 'RACAO', amount_cents: -9000, kind: 'expense' },
  ];
  const { db, updates } = fakeDb(pending);
  const ai = { run: async () => ({ response: { items: [{ i: 0, category: 'Alimentação' }, { i: 2, category: 'Investimentos' }, { i: 3, category: 'Pets' }] } }) };
  assert.equal(await categorizePending(db, ai, 'user'), 3);
  assert.deepEqual(updates, [
    { values: { category: 'Alimentação', kind: 'expense', category_source: 'ai' }, ids: ['a'] },
    { values: { category: 'Sem categoria', kind: 'expense', category_source: 'ai' }, ids: ['b'] },
    { values: { category: 'Investimentos', kind: 'investment', category_source: 'ai' }, ids: ['c'] },
    { values: { category: 'Pets', kind: 'expense', category_source: 'ai' }, ids: ['d'] },
  ]);
});
