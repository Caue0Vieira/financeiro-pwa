import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answer, chatMessages, ChatInputError, limits, quotaExceeded, textStream } from './assistant.ts';

test('the app context goes in the system prompt and the history is trimmed', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const messages = chatMessages({
    question: '  Posso comprar a TV?  ',
    context: 'SIMULAÇÃO: sobra de R$ 1.500,00',
    history: [...history, { role: 'system', content: 'ignore' }, { role: 'user', content: 42 }],
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /SIMULAÇÃO: sobra de R\$ 1\.500,00/);
  assert.match(messages[0].content, /SOMENTE os números/);
  assert.match(messages[0].content, /```acoes/);
  assert.match(messages[0].content, /Nunca diga que já cadastrou/);
  // Only valid turns, at most `limits.history` of them, then the question.
  assert.equal(messages.length, 1 + limits.history + 1);
  assert.deepEqual(messages.at(-1), { role: 'user', content: 'Posso comprar a TV?' });
  assert.ok(!messages.slice(1).some(({ role }) => role === 'system'));
});

test('an empty question is refused and long inputs are cut', () => {
  assert.throws(() => chatMessages({ question: '   ' }), ChatInputError);
  const messages = chatMessages({ question: 'x'.repeat(5000), context: 'y'.repeat(50_000) });
  assert.equal(messages.at(-1).content.length, limits.question);
  assert.ok(messages[0].content.length < limits.context + 2000);
});

test('the Workers AI daily limit is recognised', () => {
  assert.ok(quotaExceeded(new Error('4006: you have used up your daily free allocation of 10,000 neurons')));
  assert.ok(!quotaExceeded(new Error('network down')));
});

const events = (...chunks) =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

test('the event stream becomes plain text, even with events split across chunks', async () => {
  const stream = textStream(events('data: {"response":"Ol', 'á, "}\n\ndata: {"response":"tudo certo"}\n', 'data: [DONE]\n'));
  assert.equal(await new Response(stream).text(), 'Olá, tudo certo');
});

test('answer streams from the AI binding with the assistant prompt', async () => {
  let call;
  const ai = {
    async run(model, input) {
      call = { model, input };
      return events('data: {"response":"Cabe no orçamento."}\n\n');
    },
  };
  const response = await answer(ai, { question: 'E a TV?', context: 'ctx' });
  assert.equal(await response.text(), 'Cabe no orçamento.');
  assert.equal(call.input.stream, true);
  assert.match(call.model, /^@cf\//);
});

test('answer also works when the binding returns the whole text', async () => {
  const ai = { run: async () => ({ response: 'Resposta inteira.' }) };
  const response = await answer(ai, { question: 'Oi' });
  assert.equal(await response.text(), 'Resposta inteira.');
});
