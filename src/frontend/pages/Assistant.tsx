import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Account, Action, Card, Dashboard } from "../../contracts";
import { todayInSaoPaulo } from "../../date";
import MoneyField from "../components/MoneyField";
import { Field } from "../components/Field";
import { Select } from "../components/Select";
import { Icon, PageHeading, type IconName } from "../components/common";
import { Nix, type NixMood } from "../components/Nix";
import { findMerchant, inferCategory } from "../merchants";
import { cardLabel, money } from "../format";
import {
  actionsGuide, parsePurchaseQuestion, parseQuickEntry, proposalFromSimulation, proposalProblem, proposalsFrom, purchaseName,
  splitAnswer, toMutations, visibleAnswer, type Proposal, type ProposedAction,
} from "../assistantActions";
import { describeSimulation, financialSummary, simulatePurchase, type PurchaseSimulation } from "../purchase";
import type { FinanceCommands, Page } from "../types";
import "./assistant.css";

const storageKey = "financeiro-assistente";
const keptMessages = 30;
const sentHistory = 6;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  simulation?: PurchaseSimulation;
  /** Card the simulated purchase goes on, and the item name, for "Cadastrar esta compra". */
  purchase?: { cardId?: string; name: string };
  proposals?: Proposal[];
  failed?: boolean;
}

const suggestions: { text: string; prompt?: string }[] = [
  { text: "Simular uma compra", prompt: "Posso comprar uma TV de R$ 4.000 em 10x?" },
  { text: "Como estou de orçamento este mês?" },
  { text: "Anotar uma receita do mês que vem", prompt: "Mês que vem vou receber R$ 1.500 de freela, anota pra mim." },
  { text: "Quando termino de pagar as parcelas?" },
];

/** "dez/26" */
const shortMonth = (month: string) =>
  `${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")}/${month.slice(2, 4)}`;
const months = (n: number | null) => (n === null ? "sem previsão" : n === 1 ? "1 mês" : `${n} meses`);

function loadMessages(): ChatMessage[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(saved) ? saved.filter((m) => m && typeof m.content === "string" && m.id).slice(-keptMessages) : [];
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-keptMessages)));
  } catch {
    // Private mode or full storage: the chat still works, it just isn't kept.
  }
}

type Props = {
  data: Dashboard;
  commands: Pick<FinanceCommands, "assistant" | "mutate" | "refresh">;
  showNotice: (message: string, kind?: "success" | "error") => void;
};

export default function Assistant({ data, commands, showNotice }: Props) {
  const cards = data.cards.filter((card) => !card.archived);
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Keyboard on phones: the visual viewport shrinks; keep the composer right above the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const place = () => {
      const keyboard = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      root.style.setProperty("--keyboard-offset", `${keyboard}px`);
      root.toggleAttribute("data-keyboard", keyboard > 80);
    };
    place();
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
      root.style.removeProperty("--keyboard-offset");
      root.removeAttribute("data-keyboard");
    };
  }, []);

  useEffect(() => {
    if (!busy) saveMessages(messages);
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const update = (id: string, change: (message: ChatMessage) => ChatMessage) =>
    setMessages((list) => list.map((message) => (message.id === id ? change(message) : message)));

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setDraft("");
    const today = todayInSaoPaulo();
    // "gastei 45 no ifood ontem": understood here, no AI needed (also works offline and in the demo).
    const entry = parseQuickEntry(text, {
      cards, accounts: data.accounts, today, categorize: inferCategory,
      merchantName: (description) => findMerchant(description)?.name,
    });
    if (entry) {
      setMessages((list) => [
        ...list,
        { id: crypto.randomUUID(), role: "user", content: text },
        {
          id: crypto.randomUUID(), role: "assistant",
          content: "Entendi assim. Confira os dados e toque em Cadastrar.",
          proposals: [{ id: crypto.randomUUID(), action: entry, status: "pending" }],
        },
      ]);
      return;
    }
    const purchase = parsePurchaseQuestion(text, cards);
    const simulation = purchase ? simulatePurchase(data, { ...purchase, today }) : undefined;
    const lastSimulation = [...messages].reverse().find((m) => m.simulation)?.simulation;
    const context = [
      actionsGuide(today, cards),
      financialSummary(data),
      simulation ? describeSimulation(simulation) : lastSimulation ? `ÚLTIMA ${describeSimulation(lastSimulation)}` : "",
    ].filter(Boolean).join("\n\n");
    const history = messages.filter((m) => m.content).slice(-sentHistory).map(({ role, content }) => ({ role, content }));
    const answerId = crypto.randomUUID();
    setMessages((list) => [
      ...list,
      { id: crypto.randomUUID(), role: "user", content: text },
      {
        id: answerId, role: "assistant", content: "", simulation,
        purchase: purchase ? { cardId: purchase.cardId, name: purchaseName(text) } : undefined,
      },
    ]);
    if (!commands.assistant) {
      update(answerId, (m) => ({ ...m, content: "O Nix não está disponível nesta conta.", failed: true }));
      return;
    }
    setBusy(true);
    let raw = "";
    try {
      await commands.assistant.ask(text, context, history, (chunk) => {
        raw += chunk;
        update(answerId, (m) => ({ ...m, content: visibleAnswer(raw) }));
      });
      const { text: shown, raw: actions } = splitAnswer(raw);
      const proposals = proposalsFrom(actions, { cards, today, accounts: data.accounts });
      update(answerId, (m) => ({ ...m, content: shown, proposals: proposals.length ? proposals : undefined }));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "O Nix não respondeu.";
      update(answerId, (m) => ({ ...m, content: m.content || message, failed: !m.content }));
    } finally {
      setBusy(false);
    }
  }

  function recordSimulation(message: ChatMessage) {
    if (!message.simulation) return;
    const proposal = proposalFromSimulation(message.simulation, message.purchase?.cardId, message.purchase?.name ?? "Compra", todayInSaoPaulo());
    update(message.id, (m) => ({ ...m, proposals: [...(m.proposals ?? []), proposal] }));
  }

  function editProposal(messageId: string, proposalId: string, change: Partial<ProposedAction>) {
    update(messageId, (m) => ({
      ...m,
      proposals: m.proposals?.map((p) => (p.id === proposalId ? { ...p, action: { ...p.action, ...change } as ProposedAction } : p)),
    }));
  }

  async function confirm(messageId: string, proposal: Proposal) {
    if (saving || proposalProblem(proposal.action)) return;
    setSaving(proposal.id);
    try {
      for (const action of toMutations(proposal.action, todayInSaoPaulo(), cards) as Action[]) await commands.mutate(action);
      update(messageId, (m) => ({
        ...m,
        proposals: m.proposals?.map((p) => (p.id === proposal.id ? { ...p, status: "saved" } : p)),
      }));
      showNotice("Cadastrado.");
      await commands.refresh().catch(() => undefined);
    } catch (failure) {
      showNotice(failure instanceof Error ? failure.message : "Não foi possível cadastrar.", "error");
    } finally {
      setSaving("");
    }
  }

  function clear() {
    setMessages([]);
    saveMessages([]);
  }

  return (
    <div className="assistant-page">
      <PageHeading
        title="Nix"
        action={
          messages.length ? (
            <button className="button secondary assistant-clear" type="button" onClick={clear} disabled={busy}>
              Limpar
            </button>
          ) : undefined
        }
      />

      <section className="assistant-thread" aria-label="Conversa com o Nix" aria-live="polite">
        {!messages.length && (
          <div className="assistant-welcome">
            <Nix animated className="assistant-hero" />
            <h2>Oi, eu sou o Nix</h2>
            <p>
              Seu dragãozinho das finanças. Pergunte se uma compra cabe no orçamento, como está o mês ou peça para
              anotar receitas, contas e parcelas. Eu proponho e você confirma antes de cadastrar.
            </p>
            <div className="assistant-suggestions">
              {suggestions.map(({ text, prompt }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => {
                    if (prompt) {
                      setDraft(prompt);
                      input.current?.focus();
                    } else void send(text);
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={message.id} className={`assistant-turn ${message.role}`}>
            {message.simulation && <SimulationCard simulation={message.simulation} />}
            {(message.content || (busy && index === messages.length - 1)) && (
              <div className="assistant-reply">
                {message.role === "assistant" && <Nix mood={moodOf(message)} animated={index === messages.length - 1} className="assistant-face" />}
                <p className={`assistant-message ${message.role}${message.failed ? " failed" : ""}`}>
                  {message.content || <span className="assistant-typing" aria-label="Escrevendo">•••</span>}
                </p>
              </div>
            )}
            {message.simulation && !message.proposals?.length && !(busy && index === messages.length - 1) && (
              <button type="button" className="button secondary assistant-record" onClick={() => recordSimulation(message)}>
                <Icon name="plus" size={16} /> Cadastrar esta compra
              </button>
            )}
            {message.proposals?.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                cards={cards}
                accounts={data.accounts}
                saving={saving === proposal.id}
                onChange={(change) => editProposal(message.id, proposal.id, change)}
                onConfirm={() => void confirm(message.id, proposal)}
                onDiscard={() =>
                  update(message.id, (m) => ({
                    ...m,
                    proposals: m.proposals?.map((p) => (p.id === proposal.id ? { ...p, status: "discarded" } : p)),
                  }))
                }
              />
            ))}
          </div>
        ))}
        <div ref={end} />
      </section>

      <form
        className="assistant-composer"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          placeholder="Pergunte ou peça para anotar algo"
          aria-label="Mensagem"
          maxLength={600}
        />
        <button className="assistant-send" type="submit" disabled={busy || !draft.trim()} aria-label="Enviar">
          <Icon name="send" size={19} />
        </button>
      </form>
      <small className="assistant-note">Análise automática dos seus dados, não é aconselhamento financeiro.</small>
    </div>
  );
}

/** Nix's face for an answer: worried when the purchase does not fit, celebrating when the savings goal holds. */
function moodOf(message: ChatMessage): NixMood {
  if (message.failed) return "alerta";
  if (message.proposals?.some((p) => p.status === "saved")) return "feliz";
  const simulation = message.simulation;
  if (!simulation) return "normal";
  if (simulation.negativeMonths.length || simulation.fitsLimit === false) return "alerta";
  if (simulation.monthlyGoal > 0 && !simulation.monthsBelowGoal.length) return "meta";
  return "normal";
}

function SimulationCard({ simulation }: { simulation: PurchaseSimulation }) {
  const peak = Math.max(1, ...simulation.months.map((m) => Math.max(Math.abs(m.surplus), Math.abs(m.after))));
  return (
    <section className="assistant-card assistant-simulation" aria-label="Simulação da compra">
      <header>
        <Icon name="shopping" size={17} />
        <strong>
          {money(simulation.total)}
          {simulation.count > 1 ? ` em ${simulation.count}x de ${money(simulation.installment)}` : " à vista"}
        </strong>
        {simulation.cardName && <small>{cardLabel(simulation.cardName)}</small>}
      </header>
      <div className="assistant-stats">
        <div className={simulation.tightest.after < 0 ? "negative" : ""}>
          <span>Mês mais apertado</span>
          <strong>{money(simulation.tightest.after)}</strong>
          <small>{shortMonth(simulation.tightest.month)}</small>
        </div>
        <div className={simulation.negativeMonths.length ? "negative" : ""}>
          <span>No vermelho</span>
          <strong>{simulation.negativeMonths.length}</strong>
          <small>de {simulation.count} {simulation.count === 1 ? "mês" : "meses"}</small>
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
            <span>Limite</span>
            <strong>{simulation.fitsLimit ? "Cabe" : "Não cabe"}</strong>
            <small>{money(simulation.availableLimit ?? 0)} livres</small>
          </div>
        )}
      </div>
      <ol className="assistant-months" aria-label="Sobra mês a mês com a compra">
        {simulation.months.map((m) => (
          <li key={m.month}>
            <span className="assistant-month">{shortMonth(m.month)}</span>
            <span className="assistant-bar" aria-hidden="true">
              <span className="before" style={{ width: `${(Math.max(0, m.surplus) / peak) * 100}%` }} />
              <span className={m.after < 0 ? "after negative" : "after"} style={{ width: `${(Math.abs(m.after) / peak) * 100}%` }} />
            </span>
            <span className={m.after < 0 ? "assistant-value negative" : "assistant-value"}>{money(m.after)}</span>
          </li>
        ))}
      </ol>
      {simulation.targets.some((t) => t.remaining > 0) && (
        <ul className="assistant-targets" aria-label="Efeito nas metas">
          {simulation.targets.filter((t) => t.remaining > 0).map((t) => (
            <li key={t.name}>
              <strong>{t.name}</strong> {months(t.monthsBefore)} → {months(t.monthsAfter)}
            </li>
          ))}
        </ul>
      )}
      <small className="assistant-legend">
        Sobra de cada mês com a compra; o trecho apagado é o que a parcela consome.
      </small>
    </section>
  );
}

const proposalTitle: Record<string, string> = {
  entryexpense: "Gasto",
  entryincome: "Recebimento",
  income: "Receita prevista",
  expense: "Conta prevista",
  installments: "Compra parcelada",
  recurringincome: "Receita mensal",
  recurringexpense: "Conta mensal",
};

function proposalIcon(action: ProposedAction): IconName {
  if (action.type === "installments") return "card";
  if (action.type === "recurring") return "repeat";
  return action.flow === "income" ? "arrowDown" : "receipt";
}

function ProposalCard({
  proposal,
  cards,
  accounts,
  saving,
  onChange,
  onConfirm,
  onDiscard,
}: {
  proposal: Proposal;
  cards: Card[];
  accounts: Account[];
  saving: boolean;
  onChange: (change: Partial<ProposedAction>) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const { action, status } = proposal;
  const title = action.type === "installments" ? proposalTitle.installments
    : proposalTitle[`${action.type === "once" ? "" : action.type}${action.flow}`];
  const amount = action.type === "installments" ? action.total : action.amount;
  if (status !== "pending") {
    return (
      <p className={`assistant-card assistant-proposal-done ${status}`}>
        <Icon name={status === "saved" ? "check" : "close"} size={16} />
        {status === "saved" ? "Cadastrado" : "Descartado"}: {title.toLowerCase()} {action.description} · {money(amount)}
      </p>
    );
  }
  const problem = proposalProblem(action);
  return (
    <form
      className="assistant-card assistant-proposal"
      aria-label={`Confirmar ${title}`}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      <header>
        <Icon name={proposalIcon(action)} size={17} />
        <strong>{title}</strong>
        <small>confira e confirme</small>
      </header>
      <div className="assistant-proposal-fields">
        <Field label="Descrição" value={action.description} onChange={(event) => onChange({ description: event.target.value })} maxLength={80} />
        <MoneyField
          label={action.type === "installments" ? "Valor total" : "Valor"}
          name={`valor-${proposal.id}`}
          value={amount}
          onValueChange={(cents) => onChange(action.type === "installments" ? { total: cents ?? 0 } : { amount: cents ?? 0 })}
        />
        {(action.type === "once" || action.type === "entry") && (
          <Field label="Data" type="date" value={action.date} onChange={(event) => onChange({ date: event.target.value })} />
        )}
        {action.type === "entry" && (
          <>
            <Field label="Categoria" value={action.category} onChange={(event) => onChange({ category: event.target.value })} maxLength={40} />
            <Field label={action.flow === "income" ? "Entrou em" : "Pago com"}>
              <Select value={action.payWith} onChange={(event) => onChange({ payWith: event.target.value })}>
                <option value="">Sem conta definida</option>
                {action.flow === "expense" && cards.map((card) => <option key={card.id} value={`card:${card.id}`}>{cardLabel(card.name)}</option>)}
                {accounts.map((account) => <option key={account.id} value={`account:${account.id}`}>{account.name}</option>)}
              </Select>
            </Field>
          </>
        )}
        {action.type === "recurring" && (
          <>
            <Field label="Todo dia" type="number" min={1} max={31} value={action.day} onChange={(event) => onChange({ day: Number(event.target.value) })} />
            <Field label="A partir de" type="month" value={action.startMonth} onChange={(event) => onChange({ startMonth: event.target.value })} />
          </>
        )}
        {action.type === "installments" && (
          <>
            <Field label="Parcelas">
              <Select value={action.count} onChange={(event) => onChange({ count: Number(event.target.value) })}>
                {Array.from({ length: 47 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>{n}x de {money(Math.floor(action.total / n))}</option>
                ))}
              </Select>
            </Field>
            <Field label="Pagar com">
              <Select
                value={action.payWith === "account" ? "account" : action.cardId}
                onChange={(event) =>
                  onChange(event.target.value === "account" ? { payWith: "account", cardId: "" } : { payWith: "card", cardId: event.target.value })
                }
              >
                {action.payWith === "card" && !action.cardId && <option value="">Escolha o cartão</option>}
                {cards.map((card) => <option key={card.id} value={card.id}>{cardLabel(card.name)}</option>)}
                <option value="account">Boleto ou carnê</option>
              </Select>
            </Field>
            <Field label={action.payWith === "card" ? "Primeira fatura" : "Primeira parcela"} type="month" value={action.firstMonth} onChange={(event) => onChange({ firstMonth: event.target.value })} />
          </>
        )}
      </div>
      {problem && <p className="assistant-problem">{problem}</p>}
      <div className="assistant-proposal-actions">
        <button type="button" className="button secondary" onClick={onDiscard} disabled={saving}>Descartar</button>
        <button type="submit" className="button" disabled={saving || Boolean(problem)}>{saving ? "Cadastrando…" : "Cadastrar"}</button>
      </div>
    </form>
  );
}

/** Floating bubble that opens the assistant from any screen. */
export function AssistantBubble({ page, onOpen }: { page: Page; onOpen: () => void }) {
  if (page === "assistant") return null;
  return (
    <button type="button" className="assistant-bubble" onClick={onOpen} aria-label="Falar com o Nix">
      <Nix />
    </button>
  );
}
