import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Assistant as AssistantService, AssistantTurn, Dashboard } from "../../contracts";
import MoneyField from "../components/MoneyField";
import { Field } from "../components/Field";
import { Select } from "../components/Select";
import { PageHeading } from "../components/common";
import { cardLabel, money } from "../format";
import { describeSimulation, financialSummary, simulatePurchase, type PaymentMode, type PurchaseSimulation } from "../purchase";
import "./assistant.css";

const storageKey = "financeiro-assistente";
const keptMessages = 20;
const sentHistory = 6;

const suggestions = [
  "Como estou de orçamento este mês?",
  "Quando termino de pagar as parcelas?",
  "Onde estou gastando mais?",
  "Quanto falta para minhas metas?",
];

const modes: { id: PaymentMode; label: string }[] = [
  { id: "card", label: "Cartão" },
  { id: "account", label: "Boleto/carnê" },
  { id: "cash", label: "À vista" },
];

/** "dez/26" */
const shortMonth = (month: string) =>
  `${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")}/${month.slice(2, 4)}`;
const months = (n: number | null) => (n === null ? "sem previsão" : n === 1 ? "1 mês" : `${n} meses`);

function loadMessages(): AssistantTurn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(saved) ? saved.slice(-keptMessages) : [];
  } catch {
    return [];
  }
}

function saveMessages(messages: AssistantTurn[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-keptMessages)));
  } catch {
    // Private mode or full storage: the chat still works, it just isn't kept.
  }
}

export default function Assistant({ data, assistant }: { data: Dashboard; assistant?: AssistantService }) {
  const cards = data.cards.filter((card) => !card.archived);
  const [total, setTotal] = useState<number | undefined>();
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<PaymentMode>(cards.length ? "card" : "account");
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [simulation, setSimulation] = useState<PurchaseSimulation | null>(null);
  const [messages, setMessages] = useState<AssistantTurn[]>(loadMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!busy) saveMessages(messages);
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

  async function ask(question: string, context: string, shown = question) {
    if (!assistant || busy) return;
    const history = messages.slice(-sentHistory);
    setError("");
    setBusy(true);
    setMessages((list) => [...list, { role: "user", content: shown }, { role: "assistant", content: "" }]);
    const append = (text: string) =>
      setMessages((list) => {
        const last = list[list.length - 1];
        return [...list.slice(0, -1), { ...last, content: last.content + text }];
      });
    try {
      await assistant.ask(question, context, history, append);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "O assistente não respondeu.");
      // Drop the empty answer bubble; the question stays so it can be read again.
      setMessages((list) => (list[list.length - 1]?.content ? list : list.slice(0, -1)));
    } finally {
      setBusy(false);
    }
  }

  function simulate(event: FormEvent) {
    event.preventDefault();
    if (!total) return;
    const result = simulatePurchase(data, { total, count, mode, cardId: mode === "card" ? cardId : undefined });
    setSimulation(result);
    const how =
      mode === "cash" ? "à vista" : `em ${result.count}x de ${money(result.installment)}${result.cardName ? ` no ${cardLabel(result.cardName)}` : ""}`;
    void ask(
      "Analise esta compra com base na simulação: cabe no meu orçamento? Qual o impacto nas metas e nos investimentos? Vale mais parcelar ou pagar à vista?",
      `${financialSummary(data)}\n\n${describeSimulation(result)}`,
      `Simular compra de ${money(result.total)} ${how}`,
    );
  }

  function send(question: string) {
    const text = question.trim();
    if (!text) return;
    setDraft("");
    const context = simulation ? `${financialSummary(data)}\n\nÚLTIMA ${describeSimulation(simulation)}` : financialSummary(data);
    void ask(text, context);
  }

  function clear() {
    setMessages([]);
    setSimulation(null);
    setError("");
    saveMessages([]);
  }

  const peak = simulation ? Math.max(1, ...simulation.months.map((m) => Math.max(Math.abs(m.surplus), Math.abs(m.after)))) : 1;

  return (
    <div className="assistant-page">
      <PageHeading
        title="Assistente"
        description="Simule compras e tire dúvidas sobre suas finanças."
        action={
          messages.length ? (
            <button className="button secondary" type="button" onClick={clear} disabled={busy}>
              Limpar conversa
            </button>
          ) : undefined
        }
      />

      <form className="panel assistant-simulator" onSubmit={simulate} aria-label="Simular compra">
        <div className="panel-head">
          <div>
            <h2>Simular compra</h2>
            <p>Veja como uma compra afeta cada mês, suas metas e seus investimentos.</p>
          </div>
        </div>
        <div className="segmented assistant-modes" role="group" aria-label="Forma de pagamento">
          {modes.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="assistant-fields">
          <MoneyField label="Valor total" name="total" value={total} onValueChange={setTotal} required />
          {mode !== "cash" && (
            <Field label="Parcelas">
              <Select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                {Array.from({ length: 24 }, (_, index) => index + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "1x (uma vez)" : `${n}x${total ? ` de ${money(Math.floor(total / n))}` : ""}`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode === "card" && cards.length > 0 && (
            <Field label="Cartão">
              <Select value={cardId} onChange={(event) => setCardId(event.target.value)}>
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {cardLabel(card.name)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <button className="button" type="submit" disabled={!total || busy}>
          Simular
        </button>
      </form>

      {simulation && (
        <section className="panel assistant-result" aria-label="Resultado da simulação">
          <div className="assistant-stats">
            <div>
              <span>{simulation.count > 1 ? "Parcela" : "Pagamento"}</span>
              <strong>{money(simulation.installment)}</strong>
              <small>
                {simulation.count > 1
                  ? `${shortMonth(simulation.firstMonth)} a ${shortMonth(simulation.lastMonth)}`
                  : shortMonth(simulation.firstMonth)}
              </small>
            </div>
            <div className={simulation.tightest.after < 0 ? "negative" : ""}>
              <span>Mês mais apertado</span>
              <strong>{money(simulation.tightest.after)}</strong>
              <small>sobra em {shortMonth(simulation.tightest.month)}</small>
            </div>
            <div className={simulation.negativeMonths.length ? "negative" : ""}>
              <span>Meses no vermelho</span>
              <strong>{simulation.negativeMonths.length}</strong>
              <small>de {simulation.count}</small>
            </div>
            {simulation.monthlyGoal > 0 && (
              <div className={simulation.monthsBelowGoal.length ? "warning" : ""}>
                <span>Meta de economia</span>
                <strong>{simulation.count - simulation.monthsBelowGoal.length}/{simulation.count}</strong>
                <small>meses atingida</small>
              </div>
            )}
            {simulation.fitsLimit !== null && (
              <div className={simulation.fitsLimit ? "" : "negative"}>
                <span>Limite do cartão</span>
                <strong>{simulation.fitsLimit ? "Cabe" : "Não cabe"}</strong>
                <small>{money(simulation.availableLimit ?? 0)} livres</small>
              </div>
            )}
            {simulation.investedShare !== null && (
              <div>
                <span>Dos investimentos</span>
                <strong>{Math.round(simulation.investedShare * 100)}%</strong>
                <small>se pagar com eles</small>
              </div>
            )}
          </div>
          <ol className="assistant-months" aria-label="Sobra mês a mês">
            {simulation.months.map((m) => (
              <li key={m.month}>
                <span className="assistant-month">{shortMonth(m.month)}</span>
                <span className="assistant-bar" aria-hidden="true">
                  <span className="before" style={{ width: `${(Math.max(0, m.surplus) / peak) * 100}%` }} />
                  <span
                    className={m.after < 0 ? "after negative" : "after"}
                    style={{ width: `${(Math.abs(m.after) / peak) * 100}%` }}
                  />
                </span>
                <span className={m.after < 0 ? "assistant-value negative" : "assistant-value"}>{money(m.after)}</span>
              </li>
            ))}
          </ol>
          <p className="assistant-legend">
            Barra forte: sobra com a compra. Trecho apagado: o que a parcela consome. Estimativa a partir das contas recorrentes, das parcelas e da média de gastos dos últimos meses.
          </p>
          {simulation.targets.some((t) => t.remaining > 0) && (
            <ul className="assistant-targets" aria-label="Efeito nas metas">
              {simulation.targets
                .filter((t) => t.remaining > 0)
                .map((t) => (
                  <li key={t.name}>
                    <strong>{t.name}</strong>
                    <span>
                      faltam {money(t.remaining)} · {months(t.monthsBefore)} → {months(t.monthsAfter)} com a compra
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      <section className="panel assistant-chat" aria-label="Conversa com o assistente">
        {!assistant && <p className="empty">O assistente não está disponível nesta conta.</p>}
        {assistant && !messages.length && (
          <div className="assistant-suggestions">
            {suggestions.map((text) => (
              <button key={text} type="button" className="button secondary" onClick={() => send(text)} disabled={busy}>
                {text}
              </button>
            ))}
          </div>
        )}
        <div className="assistant-messages" aria-live="polite">
          {messages.map((message, index) => (
            <p key={index} className={`assistant-message ${message.role}`}>
              {message.content || (busy && index === messages.length - 1 ? "Pensando…" : "")}
            </p>
          ))}
          <div ref={end} />
        </div>
        {error && (
          <p role="alert" className="assistant-error">
            {error}
          </p>
        )}
        <form
          className="assistant-input"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Pergunte sobre suas finanças"
            aria-label="Pergunta"
            maxLength={600}
            disabled={!assistant}
          />
          <button className="button" type="submit" disabled={!assistant || busy || !draft.trim()}>
            Enviar
          </button>
        </form>
        <small className="assistant-note">
          Análise automática dos seus próprios dados, não é aconselhamento financeiro.
        </small>
      </section>
    </div>
  );
}
