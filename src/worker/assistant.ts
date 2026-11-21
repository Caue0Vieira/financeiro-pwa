import { aiModel, type Ai } from "./categorize.ts";

/**
 * Assistant chat (POST /api/chat). The app computes every number (src/frontend/purchase.ts) and
 * sends it as plain text; Workers AI only explains it. No database reads here, so a question
 * costs one auth check and one AI call, well inside the free plan.
 */

export const limits = { question: 600, context: 12_000, history: 6, message: 2_000 };

export type ChatTurn = { role: "user" | "assistant"; content: string };

export class ChatInputError extends Error {}

export const systemPrompt = [
  "Você é o assistente financeiro do app pessoal do usuário. Responda em português do Brasil, em até 3 parágrafos curtos ou uma lista curta.",
  "Use SOMENTE os números do contexto enviado pelo app. Nunca invente valores nem refaça as contas: se a simulação já traz um resultado, cite-o.",
  "Se faltar algum dado para responder, diga qual e sugira cadastrá-lo no app.",
  "Ao analisar uma compra, comente: o mês mais apertado, se algum mês fica negativo, o efeito na meta mensal de economia e nas metas, e a comparação com pagar à vista usando os investimentos, quando houver.",
  "Valores sempre em reais, no formato R$ 1.234,56. Seja direto e prático, sem rodeios.",
  "Você analisa os dados do próprio usuário; não é consultor financeiro e não recomenda investimentos específicos.",
].join("\n");

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Validates the app's request and builds the messages for the model. */
export function chatMessages(input: Record<string, unknown>) {
  const question = text(input.question, limits.question);
  if (!question) throw new ChatInputError("Escreva uma pergunta.");
  const context = text(input.context, limits.context);
  const history: ChatTurn[] = (Array.isArray(input.history) ? input.history : [])
    .filter((turn): turn is ChatTurn => (turn?.role === "user" || turn?.role === "assistant") && typeof turn.content === "string")
    .slice(-limits.history)
    .map(({ role, content }) => ({ role, content: content.slice(0, limits.message) }));
  return [
    { role: "system", content: `${systemPrompt}\n\nDados do usuário:\n${context || "(o app não enviou dados)"}` },
    ...history,
    { role: "user", content: question },
  ];
}

/** The daily free allocation of Workers AI ran out (error 4006). */
export const quotaExceeded = (error: unknown) =>
  /4006|daily free allocation|neurons/i.test(error instanceof Error ? error.message : String(error));

/** Turns the Workers AI event stream (`data: {"response": "..."}`) into plain text chunks. */
export function textStream(events: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const emit = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const data = line.match(/^data:\s?(.*)$/)?.[1];
    if (!data || data === "[DONE]") return;
    try {
      const chunk = (JSON.parse(data) as { response?: unknown }).response;
      if (typeof chunk === "string" && chunk) controller.enqueue(encoder.encode(chunk));
    } catch {
      // A malformed event only loses that piece of text.
    }
  };
  return events.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        pending += decoder.decode(bytes, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) emit(line.trim(), controller);
      },
      flush(controller) {
        emit(pending.trim(), controller);
      },
    }),
  );
}

export async function answer(ai: Ai, input: Record<string, unknown>) {
  const messages = chatMessages(input);
  const result = await ai.run(aiModel, { messages, stream: true, max_tokens: 700, temperature: 0.3 });
  const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
  if (result instanceof ReadableStream) return new Response(textStream(result), { headers });
  // Without streaming support the binding returns the whole answer at once.
  const whole = (result as { response?: unknown })?.response;
  return new Response(typeof whole === "string" ? whole : "", { headers });
}
