import { useEffect, useId, useState } from "react";
import type {
  Action,
  Dashboard,
  Entry,
  EntryKind,
  FinanceService,
  Investment,
  Recurrence,
} from "../../contracts";
import { addDays, invoiceDates, todayInSaoPaulo } from "../../date";
import { Icon } from "./common";
import { BankIcon, bankSuggestions, findBank } from "./BankIcon";
import { CardModelPicker } from "./HomeCardArt";
import { Field } from "./Field";
import { Overlay } from "./Overlay";
import { Select } from "./Select";
import MoneyField from "./MoneyField";
import { parseBrazilianAmount } from "../../imports/parsers";
import { dateLabel, kindLabel, money, monthName } from "../format";
import { findMerchant, inferCategory, isShopping, merchants } from "../merchants";
import type { EditModal } from "../types";

export default function Editor({
  modal,
  data,
  month,
  busy,
  error,
  loadHistory,
  close,
  mutate,
  changeModal,
}: {
  modal: Exclude<EditModal, { type: "commitment" | "card-picker" }>;
  data: Dashboard;
  month: string;
  busy: boolean;
  error: string;
  loadHistory: FinanceService["history"];
  close: () => void;
  mutate: (action: Action) => Promise<void>;
  changeModal: (modal: EditModal) => void;
}) {
  const { type, item } = modal;
  let removeAction: Action | undefined;
  if (item) {
    if (type === "recurrence") removeAction = { type: "endRecurrence", id: item.id, endMonth: month };
    if (type === "entry") removeAction = { type: "deleteEntry", id: item.id };
    if (type === "investment") removeAction = { type: "deleteInvestment", id: item.id };
    if (type === "target") removeAction = { type: "deleteTarget", id: item.id };
    if (type === "card") removeAction = { type: "archiveCard", id: item.id };
  }
  const today = todayInSaoPaulo();
  const entryDate = (type === "entry" && item?.date) || (today.startsWith(month) ? today : `${month}-01`);
  const investmentBalanceHint = useId();
  const [kind, setKind] = useState<EntryKind>(
    type === "entry" ? (modal.item?.kind ?? modal.kind ?? "expense") : "expense",
  );
  const currentBank = type === "card" ? data.accounts.find(({ id }) => id === item?.accountId)?.name : undefined;
  const [linkedCard, setLinkedCard] = useState(
    type === "card" && (item ? Boolean(currentBank) : !modal.standalone),
  );
  const [bankName, setBankName] = useState(currentBank ?? "");
  const [cardName, setCardName] = useState(type === "card" && item?.name !== currentBank ? (item?.name ?? "") : "");
  const [design, setDesign] = useState<string | null>(type === "card" ? (item?.design ?? null) : null);
  const designBank = type === "card" && linkedCard ? findBank(bankName) : undefined;
  const bankOptionsId = useId();
  const [description, setDescription] = useState(type === "entry" ? (item?.description ?? "") : "");
  const [category, setCategory] = useState(type === "entry" ? (item?.category ?? "") : "");
  const [paymentMethod, setPaymentMethod] = useState(() => {
    if (type !== "entry") return "";
    if (item?.cardId) return `card:${item.cardId}`;
    return item?.accountId ? `account:${item.accountId}` : "";
  });
  const cardId = paymentMethod.startsWith("card:") ? paymentMethod.slice(5) : undefined;
  const accountId = paymentMethod.startsWith("account:") ? paymentMethod.slice(8) : undefined;
  const visibleCards = data.cards.filter((card) => !card.archived || (type === "entry" && card.id === item?.cardId));
  const paymentAccounts = data.accounts.filter(
    (account) => kind === "card_payment" || account.id === accountId || visibleCards.some((card) => card.accountId === account.id),
  );
  const [remove, setRemove] = useState(false);
  const [paymentMonth, setPaymentMonth] = useState<string>(type === "settle" ? item.month : month);
  const [payments, setPayments] = useState<Entry[]>([]);
  const [paymentId, setPaymentId] = useState("");
  const [settlementAmount, setSettlementAmount] = useState<number>();
  const [paymentState, setPaymentState] = useState<"loading" | "ready" | "failed">("loading");
  const chooseDirection = kind === "investment" || kind === "transfer" || kind === "uncategorized";
  useEffect(() => {
    if (type !== "settle" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(paymentMonth)) return;
    let active = true;
    async function loadPayments() {
      setPaymentState("loading");
      const candidates: Entry[] = [];
      try {
        const limit = 100;
        for (let offset = 0; active; offset += limit) {
          const page = await loadHistory(paymentMonth, offset, limit);
          candidates.push(
            ...page.filter(
              (entry) =>
                entry.kind === "card_payment" &&
                entry.status === "confirmed" &&
                -entry.amount > (entry.allocatedAmount ?? 0),
            ),
          );
          if (page.length < limit) break;
        }
        if (active) {
          setPayments(candidates);
          setPaymentState("ready");
        }
      } catch {
        if (active) setPaymentState("failed");
      }
    }
    void loadPayments();
    return () => {
      active = false;
    };
  }, [type, paymentMonth, loadHistory]);
  const titles: Record<string, string> = {
    entry: item ? "Editar lançamento" : "Novo lançamento",
    budget: "Editar orçamento",
    target: item ? "Editar meta financeira" : "Nova meta financeira",
    contribution: "Registrar aporte",
    investment: item ? "Editar investimento" : "Novo investimento",
    recurrence: item ? "Editar recorrência" : "Nova recorrência",
    card: item ? "Editar cartão" : linkedCard ? "Cartão de outro banco" : "Cartão avulso",
    settle: "Conciliar fatura",
    "invoice-dates": "Datas da fatura",
  };
  const invoiceCard = type === "invoice-dates" ? data.cards.find(({ id }) => id === item.cardId) : undefined;
  const usualDates = type === "invoice-dates"
    ? invoiceDates(item.month, invoiceCard?.closingDay ?? null, invoiceCard?.dueDay ?? null)
    : undefined;
  const [closingDate, setClosingDate] = useState(type === "invoice-dates" ? (item.closingDate ?? "") : "");
  const amount = (n: number | undefined) => (n == null ? undefined : Math.abs(n));
  const read = (f: FormData, k: string) => String(f.get(k) || "").trim();
  const cents = (f: FormData, k: string) => parseBrazilianAmount(read(f, k));
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (type === "entry") {
      const raw = cents(f, "amount");
      const inferred = kind === "expense" ? inferCategory(description) : "";
      const finalCategory = category.trim() || read(f, "category") || (item ? "" : inferred);
      void mutate({
        type: "saveEntry",
        entry: {
          ...(item || {}),
          id: item?.id,
          date: read(f, "date") || entryDate,
          description: description.trim(),
          amount:
            kind === "expense" ||
            kind === "card_payment" ||
            kind === "saving" ||
            (chooseDirection && read(f, "direction") === "out")
              ? -raw
              : raw,
          kind,
          category: finalCategory,
          status: read(f, "status") as Entry["status"],
          accountId,
          cardId,
          invoiceMonth: cardId ? read(f, "invoiceMonth") || month : undefined,
        },
      });
    } else if (type === "budget") void mutate({ type: "saveBudget", month, amount: cents(f, "amount") });
    else if (type === "target")
      void mutate({
        type: "saveTarget",
        target: { id: item?.id, name: read(f, "name"), amount: cents(f, "amount") },
      });
    else if (type === "contribution")
      void mutate({ type: "contributeTarget", id: item.id, amount: cents(f, "amount") });
    else if (type === "investment")
      void mutate({
        type: "saveInvestment",
        investment: {
          id: item?.id,
          name: read(f, "name"),
          institution: read(f, "institution"),
          contributed: cents(f, "contributed"),
          value: cents(f, "value"),
          updatedOn: read(f, "updatedOn") || item?.updatedOn || today,
        },
      });
    else if (type === "card")
      void mutate({
        type: "saveCard",
        card: {
          id: item?.id,
          name: cardName.trim() || bankName.trim(),
          bank: linkedCard ? bankName.trim() : undefined,
          dueDay: Number(read(f, "dueDay")) || null,
          closingDay: Number(read(f, "closingDay")) || null,
          // Only a recognised bank has models; a different bank or a standalone card resets it.
          design: designBank && designBank.designs.some(({ id }) => id === design) ? design : null,
        },
      });
    else if (type === "recurrence") {
      const k = read(f, "kind") as "income" | "expense";
      void mutate({
        type: "saveRecurrence",
        recurrence: {
          id: item?.id,
          description: read(f, "description"),
          amount: (k === "expense" ? -1 : 1) * cents(f, "amount"),
          kind: k,
          category: read(f, "category"),
          startMonth: read(f, "startMonth") || item?.startMonth || month,
          day: Number(read(f, "day")),
          endMonth: read(f, "endMonth") || undefined,
        },
        effectiveMonth: read(f, "effectiveMonth") || undefined,
      });
    } else if (type === "settle")
      void mutate({
        type: "settleInvoice",
        paymentId: read(f, "paymentId"),
        cardId: item.cardId,
        month: item.month,
        amount: cents(f, "amount"),
      });
    else if (type === "invoice-dates") {
      // Store only what differs from the card's usual days, so later changes to them still apply.
      const differs = (value: string, usual: string | null | undefined) => (value && value !== usual ? value : null);
      void mutate({
        type: "saveInvoiceDates",
        cardId: item.cardId,
        month: item.month,
        closingDate: differs(read(f, "closingDate"), usualDates?.closingDate),
        dueDate: differs(read(f, "dueDate"), usualDates?.dueDate),
      });
    }
  };
  return (
    <Overlay title={titles[type]} onClose={close}>
      <form
        onSubmit={submit}
        onInvalid={(event) => {
          const details = (event.target as HTMLElement).closest("details");
          if (details) details.open = true;
        }}
      >
        <div className="form-grid">
          {type === "budget" && (
            <MoneyField
              label="Limite mensal (R$)"
              name="amount"
              min={0}
              defaultValue={amount(data.budget || undefined)}
              required
              full
            />
          )}
          {type === "target" && (
            <>
              <Field
                label="Nome da meta"
                name="name"
                defaultValue={item?.name ?? modal.name}
                placeholder="Ex.: Viagem de férias"
                maxLength={70}
                pattern={".*\\S.*"}
                required
                full
              />
              <MoneyField
                label="Valor da meta (R$)"
                name="amount"

                defaultValue={amount(item?.amount)}
                required
                full
              />
            </>
          )}
          {type === "contribution" && (
            <>
              <p className="form-hint full">
                {item.name} · {money(item.saved)} guardados
              </p>
              <MoneyField
                label="Valor do aporte (R$)"
                name="amount"

                required
                full
              />
            </>
          )}
          {type === "entry" && (
            <>
              <Field
                label="Descrição"
                name="description"
                value={description}
                onChange={(event) => {
                  const val = event.target.value;
                  setDescription(val);
                  const inf = inferCategory(val);
                  if (inf) setCategory(inf);
                }}
                placeholder={kind === "income" ? "Ex.: Salário" : "Ex.: iFood, ChatGPT, Uber..."}
                pattern={".*\\S.*"}
                required
                full
              />
              {!item && kind === "expense" && (
                <div className="entry-shortcuts full" role="group" aria-label="Atalhos de descrição">
                  {merchants.slice(0, 7).map((merchant) => (
                    <button
                      key={merchant.name}
                      type="button"
                      className="entry-shortcut"
                      aria-label={merchant.name}
                      title={`${merchant.name} (${merchant.category})`}
                      aria-pressed={description === merchant.name}
                      onClick={() => {
                        setDescription(merchant.name);
                        setCategory(merchant.category);
                        const amountEl = document.querySelector<HTMLInputElement>('input[name="amount"]');
                        amountEl?.focus();
                      }}
                    >
                      <span className="transaction-icon merchant-icon" style={{ backgroundColor: merchant.background }}>
                        <img src={merchant.icon} alt="" />
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="entry-shortcut"
                    aria-label="Compra"
                    title="Compra (Compras)"
                    aria-pressed={description === "Compra"}
                    onClick={() => {
                      setDescription("Compra");
                      setCategory("Compras");
                      const amountEl = document.querySelector<HTMLInputElement>('input[name="amount"]');
                      amountEl?.focus();
                    }}
                  >
                    <span className="transaction-icon tone-violet"><Icon name="cart" size={18} /></span>
                  </button>
                </div>
              )}
              {kind === "expense" && (category || inferCategory(description)) && (
                <div className="entry-inferred-tag full" style={{ fontSize: ".78rem", color: "var(--accent)", display: "flex", alignItems: "center", gap: "6px", margin: "-6px 0 2px" }}>
                  <Icon name="receipt" size={14} />
                  <span>Categoria: <strong>{category || inferCategory(description)}</strong></span>
                </div>
              )}
              <MoneyField
                label="Valor (R$)"
                name="amount"

                defaultValue={amount(item?.amount)}
                required
              />
              <Field label="Tipo">
                <Select value={kind} onChange={(e) => setKind(e.target.value as EntryKind)}>
                  {Object.entries(kindLabel).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              {chooseDirection && (
                <Field label="Movimento">
                  <Select name="direction" defaultValue={(item?.amount ?? 0) > 0 ? "in" : "out"}>
                    <option value="out">Saída</option>
                    <option value="in">Entrada</option>
                  </Select>
                </Field>
              )}
              {(paymentAccounts.length > 0 || visibleCards.length > 0) && (
                <Field label="Banco ou cartão" full>
                  <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                    <option value="">Sem vínculo</option>
                    {paymentAccounts.length > 0 && (
                      <optgroup label="Bancos">
                        {paymentAccounts.map(({ id, name }) => <option key={id} value={`account:${id}`}>{name}</option>)}
                      </optgroup>
                    )}
                    {visibleCards.length > 0 && (
                      <optgroup label="Cartões">
                        {visibleCards.map(({ id, name, archived }) => (
                          <option key={id} value={`card:${id}`}>{name}{archived && " (excluído)"}</option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </Field>
              )}
              {cardId && (
                <Field
                  label="Mês da fatura"
                  name="invoiceMonth"
                  type="month"
                  defaultValue={item?.invoiceMonth || month}
                  required
                  full
                />
              )}
              <details className="form-details full">
                <summary>Data, categoria e situação</summary>
                <div className="form-grid">
                  <Field
                    label="Data"
                    name="date"
                    type="date"
                    defaultValue={entryDate}
                  />
                  <Field label="Situação">
                    <Select name="status" defaultValue={item?.status || "confirmed"}>
                      <option value="confirmed">Confirmado</option>
                      <option value="planned">Previsto</option>
                    </Select>
                  </Field>
                  <Field
                    label="Categoria"
                    name="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Ex.: Alimentação"
                    full
                  />
                </div>
              </details>
            </>
          )}
          {type === "investment" && (
            <>
              <Field
                label="Nome do investimento"
                name="name"
                defaultValue={item?.name}
                placeholder="Ex.: CDB de liquidez diária"
                required
                full
              />
              <Field
                label="Instituição"
                name="institution"
                defaultValue={item?.institution}
                placeholder="Ex.: Banco Inter"
                full
              />
              <MoneyField
                label="Valor aplicado (R$)"
                name="contributed"
                min={0}
                defaultValue={amount(item?.contributed)}
                required
              />
              <MoneyField
                label="Saldo atual (R$)"
                name="value"
                min={0}
                defaultValue={amount(item?.value)}
                aria-describedby={investmentBalanceHint}
                required
              />
              <p className="form-hint full" id={investmentBalanceHint}>
                Use o saldo que aparece na sua instituição na data da atualização, com os ganhos ou perdas.
              </p>
              <details className="form-details full">
                <summary>Data da atualização</summary>
                <Field
                  label="Data"
                  name="updatedOn"
                  type="date"
                  defaultValue={item?.updatedOn || today}
                  full
                />
              </details>
            </>
          )}
          {type === "card" && (
            <>
              {item && <div className="segmented card-link-mode full" role="group" aria-label="Vínculo do cartão">
                <button type="button" aria-pressed={linkedCard} onClick={() => setLinkedCard(true)}>Com banco</button>
                <button
                  type="button"
                  aria-pressed={!linkedCard}
                  onClick={() => {
                    setLinkedCard(false);
                    setCardName((name) => name || item?.name || "");
                  }}
                >
                  Avulso
                </button>
              </div>}
              {linkedCard ? (
                <div className="card-bank-field full">
                  <Field
                    label="Banco"
                    value={bankName}
                    onChange={(event) => setBankName(event.target.value)}
                    list={bankOptionsId}
                    placeholder="Ex.: Banco Inter"
                    pattern={".*\\S.*"}
                    required
                  />
                  <BankIcon bank={bankName.trim() || undefined} />
                  <datalist id={bankOptionsId}>
                    {[...new Set([...data.accounts.map(({ name }) => name), ...bankSuggestions])].map((name) => (
                      <option value={name} key={name} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <Field
                  label="Nome do cartão"
                  value={cardName}
                  onChange={(event) => setCardName(event.target.value)}
                  placeholder="Ex.: Cartão da loja"
                  pattern={".*\\S.*"}
                  required
                  full
                />
              )}
              {designBank && designBank.designs.length > 1 && (
                <div className="field full">
                  Modelo do cartão
                  <CardModelPicker bank={designBank} value={design} onChange={setDesign} />
                </div>
              )}
              {item && (
                <>
                  <Field
                    label="Dia que a fatura fecha"
                    name="closingDay"
                    type="number"
                    min="1"
                    max="31"
                    defaultValue={item?.closingDay ?? undefined}
                    placeholder="Ex.: 3"
                  />
                  <Field
                    label="Dia que a fatura vence"
                    name="dueDay"
                    type="number"
                    min="1"
                    max="31"
                    defaultValue={item?.dueDay ?? undefined}
                    placeholder="Ex.: 10"
                  />
                  <p className="form-hint full">
                    Esses dias se repetem todo mês. Para mudar só um mês, use Compromissos → Faturas do cartão.
                  </p>
                  {linkedCard && (
                    <details className="form-details full">
                      <summary>Nome do cartão (opcional)</summary>
                      <Field
                        label="Nome do cartão"
                        value={cardName}
                        onChange={(event) => setCardName(event.target.value)}
                        placeholder="Ex.: Cartão principal"
                        full
                      />
                    </details>
                  )}
                </>
              )}
            </>
          )}
          {type === "recurrence" && (
            <>
              <Field
                label="Descrição"
                name="description"
                defaultValue={item?.description}
                placeholder="Ex.: Mensalidade da academia"
                required
                full
              />
              <MoneyField
                label="Valor (R$)"
                name="amount"

                defaultValue={amount(item?.amount)}
                required
              />
              <Field label="Tipo">
                <Select name="kind" defaultValue={item?.kind || "expense"}>
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </Select>
              </Field>
              <Field
                label="Dia do mês"
                name="day"
                type="number"
                min="1"
                max="31"
                defaultValue={item?.day || 1}
                required
                full
              />
              <details className="form-details full">
                <summary>Categoria e período</summary>
                <div className="form-grid">
                  <Field label="Categoria" name="category" defaultValue={item?.category} placeholder="Ex.: Saúde" full />
                  <Field label="Mês inicial" name="startMonth" type="month" defaultValue={item?.startMonth || month} />
                  <Field label="Mês final" name="endMonth" type="month" defaultValue={item?.endMonth} />
                  {item && (
                    <Field
                      label="Aplicar alteração a partir de"
                      name="effectiveMonth"
                      type="month"
                      defaultValue={month}
                      full
                    />
                  )}
                </div>
              </details>
            </>
          )}
          {type === "settle" && (
            <>
              <p className="form-hint full">
                Selecione um pagamento de cartão para associar à fatura de {monthName(item.month)}. Valor
                restante: {money(item.total - item.paid)}.
              </p>
              <Field label="Mês do pagamento" full>
                <input
                  type="month"
                  value={paymentMonth}
                  required
                  onChange={(e) => {
                    setPaymentMonth(e.target.value);
                    setPaymentId("");
                    setSettlementAmount(undefined);
                    setPayments([]);
                  }}
                />
              </Field>
              <Field label="Pagamento" full>
                <Select
                  name="paymentId"
                  value={paymentId}
                  required
                  onChange={(e) => {
                    const id = e.target.value;
                    const selected = payments.find((payment) => payment.id === id);
                    setPaymentId(id);
                    const available = selected ? -selected.amount - (selected.allocatedAmount ?? 0) : 0;
                    setSettlementAmount(
                      selected ? Math.max(0, Math.min(available, item.total - item.paid)) : undefined,
                    );
                  }}
                >
                  <option value="">Selecione um pagamento</option>
                  {payments.map((payment) => (
                    <option key={payment.id} value={payment.id}>
                      {payment.description} · {dateLabel(payment.date)} ·{" "}
                      {money(-payment.amount - (payment.allocatedAmount ?? 0))} disponível
                    </option>
                  ))}
                </Select>
              </Field>
              {paymentState === "loading" && paymentMonth && (
                <p role="status" className="form-hint full">
                  Buscando pagamentos…
                </p>
              )}
              {paymentState === "failed" && (
                <p role="alert" className="form-hint full">
                  Não foi possível buscar os pagamentos.
                </p>
              )}
              {paymentState === "ready" && payments.length === 0 && (
                <p className="form-hint full">Nenhum pagamento com saldo disponível nesse mês.</p>
              )}
              <MoneyField
                label="Valor a conciliar (R$)"
                name="amount"

                value={settlementAmount}
                onValueChange={setSettlementAmount}
                required
                full
              />
            </>
          )}
          {type === "invoice-dates" && (
            <>
              <p className="form-hint full">
                Ajuste só a fatura de {monthName(item.month)} de {invoiceCard?.name || "este cartão"}. Os outros meses
                continuam com os dias do cadastro do cartão.
              </p>
              <Field label="Fecha em">
                <input
                  type="date"
                  name="closingDate"
                  value={closingDate}
                  onChange={(event) => setClosingDate(event.target.value)}
                />
              </Field>
              <Field label="Vence em">
                <input
                  type="date"
                  name="dueDate"
                  defaultValue={item.dueDate ?? ""}
                  min={closingDate ? addDays(closingDate, 1) : undefined}
                />
              </Field>
              {usualDates && (usualDates.closingDate || usualDates.dueDate) && (
                <p className="form-hint full">
                  Padrão do cartão:{" "}
                  {[
                    usualDates.closingDate && `fecha ${dateLabel(usualDates.closingDate)}`,
                    usualDates.dueDate && `vence ${dateLabel(usualDates.dueDate)}`,
                  ].filter(Boolean).join(" e ")}.
                </p>
              )}
            </>
          )}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="button" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
          <button type="button" className="button secondary" onClick={close}>
            Cancelar
          </button>
          {type === "target" && item && (
            <button
              type="button"
              className="button secondary"
              onClick={() => changeModal({ type: "contribution", item })}
            >
              <Icon name="plus" size={16} /> Registrar aporte
            </button>
          )}
          {type === "invoice-dates" && item.adjusted && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void mutate({ type: "saveInvoiceDates", cardId: item.cardId, month: item.month, closingDate: null, dueDate: null })
              }
            >
              Voltar ao padrão do cartão
            </button>
          )}
          {removeAction && !remove && (
            <button type="button" className="button danger" disabled={busy} onClick={() => setRemove(true)}>
              {type === "recurrence" ? "Encerrar" : type === "card" ? "Excluir cartão" : "Excluir"}
            </button>
          )}
        </div>
        {remove && removeAction && (
          <div className="confirm-delete">
            <p>
              {type === "recurrence"
                ? "Encerrar esta recorrência neste mês?"
                : type === "card"
                  ? "Excluir este cartão? As compras e faturas registradas continuam no histórico."
                  : "Excluir este item? Esta ação não pode ser desfeita."}
            </p>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void mutate(removeAction)}
            >
              Confirmar {type === "recurrence" ? "encerramento" : "exclusão"}
            </button>
          </div>
        )}
      </form>
    </Overlay>
  );
}
