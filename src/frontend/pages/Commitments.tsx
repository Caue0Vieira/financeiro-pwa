import type { ReactNode } from "react";
import type { Dashboard, Invoice } from "../../contracts";
import { BankIcon } from "../components/BankIcon";
import { EntryBadge, Entries, Icon, PageHeading } from "../components/common";
import {
  installmentPlans,
  monthBreakdown,
  monthlyTotal,
  oneOffEntries,
  recurringGroups,
  type InstallmentPlan,
  type MonthBreakdown,
  type RecurringItem,
} from "../commitments";
import { cardLabel, dateLabel, money, monthName } from "../format";
import type { CommitmentMode, CommitmentView, OpenEditor } from "../types";

const parts: { id: keyof MonthBreakdown; label: string }[] = [
  { id: "fixed", label: "Contas fixas" },
  { id: "subscriptions", label: "Assinaturas" },
  { id: "invoices", label: "Faturas do cartão" },
  { id: "oneOff", label: "Outras contas" },
];

const views: Record<CommitmentView, { title: string; all: string; addLabel?: string; mode?: CommitmentMode }> = {
  fixed: { title: "Contas fixas", all: "Ver todas as contas fixas", addLabel: "Adicionar conta fixa", mode: "monthly" },
  subscriptions: { title: "Assinaturas", all: "Ver todas as assinaturas", addLabel: "Adicionar assinatura", mode: "subscription" },
  installments: { title: "Compras parceladas", all: "Ver todas as parcelas", addLabel: "Adicionar compra parcelada", mode: "installments" },
  invoices: { title: "Faturas do cartão", all: "Ver todas as faturas" },
  oneOff: { title: "Contas avulsas", all: "Ver todas as contas avulsas", addLabel: "Adicionar conta avulsa", mode: "once" },
  income: { title: "Receitas fixas", all: "Ver todas as receitas fixas" },
};

const monthOnly = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "");

const shortMonth = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    .replace(".", "")
    .replace(" de ", " ");

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything the screens need, computed once per render. */
function commitmentData(data: Dashboard) {
  const groups = recurringGroups(data, data.month);
  const plans = installmentPlans(data.installments);
  const oneOff = oneOffEntries(data.upcoming);
  // Installments and recurring card charges already have their own sections.
  const otherCardEntries = data.upcoming.filter(
    (entry) => entry.cardId && !entry.installmentCount && !entry.recurrenceId,
  );
  return { groups, plans, oneOff, otherCardEntries };
}

/** Month view: one collapsed section per kind, showing only what falls in the month. */
export default function Commitments({
  data,
  monthControl,
  setModal,
  openView,
}: {
  data: Dashboard;
  monthControl: ReactNode;
  setModal: OpenEditor;
  openView: (view: CommitmentView) => void;
}) {
  const { groups, plans, oneOff, otherCardEntries } = commitmentData(data);
  const breakdown = monthBreakdown(data);
  const breakdownTotal = parts.reduce((sum, { id }) => sum + breakdown[id], 0);
  const rows = rowRenderers(data, setModal);
  // Rules that only start in a later month are left for the full screen.
  const started = (items: RecurringItem[]) => items.filter((item) => item.started);
  const fixed = started(groups.fixed);
  const subscriptions = started(groups.subscriptions);
  const income = started(groups.income);
  const invoicesTotal = data.invoices.reduce((sum, invoice) => sum + invoice.total, 0);

  return (
    <>
      <PageHeading
        title="Contas a pagar"
        action={
          <button className="button" onClick={() => setModal({ type: "commitment" })}>
            <Icon name="plus" size={16} /> Nova conta
          </button>
        }
      />
      <div className="screen-stack commitments">
        <section className="panel commitments-summary" aria-label="Resumo do mês">
          <div>
            <h2>A pagar no mês</h2>
            <strong>{money(data.toPay)}</strong>
          </div>
          {monthControl}
          {breakdownTotal > 0 ? (
            <div className="commitments-breakdown">
              <div className="commitments-bar" aria-hidden="true">
                {parts.map(({ id }, index) =>
                  breakdown[id] > 0 ? (
                    <i
                      key={id}
                      style={{
                        flexGrow: breakdown[id],
                        background: `var(--chart-category-${index + 1})`,
                      }}
                    />
                  ) : null,
                )}
              </div>
              <ul>
                {parts.map(({ id, label }, index) =>
                  breakdown[id] > 0 ? (
                    <li key={id}>
                      <i style={{ background: `var(--chart-category-${index + 1})` }} aria-hidden="true" />
                      <span>{label}</span>
                      <strong>{money(breakdown[id])}</strong>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          ) : (
            <p className="commitments-clear">Nada pendente neste mês.</p>
          )}
        </section>

        <Collapsible
          view="fixed"
          amount={monthlyTotal(fixed)}
          detail={count(fixed.length, "conta", "contas")}
          openView={openView}
        >
          {fixed.length ? rows.recurring(fixed) : <p className="empty">Nenhuma conta fixa neste mês.</p>}
        </Collapsible>

        <Collapsible
          view="subscriptions"
          amount={monthlyTotal(subscriptions)}
          detail={count(subscriptions.length, "assinatura", "assinaturas")}
          openView={openView}
        >
          {subscriptions.length ? rows.recurring(subscriptions) : <p className="empty">Nenhuma assinatura neste mês.</p>}
        </Collapsible>

        <Collapsible
          view="installments"
          amount={plans.reduce((sum, plan) => sum + plan.amount, 0)}
          detail={count(plans.length, "parcela", "parcelas")}
          openView={openView}
        >
          {plans.length ? rows.installments(plans, true) : <p className="empty">Nenhuma parcela neste mês.</p>}
        </Collapsible>

        <Collapsible
          view="invoices"
          amount={invoicesTotal}
          detail={count(data.invoices.length, "fatura", "faturas")}
          openView={openView}
        >
          {data.invoices.length ? rows.invoices(data.invoices, true) : <p className="empty">Nenhuma fatura neste mês.</p>}
          {otherCardEntries.length > 0 && (
            <p className="commitment-note">
              {count(otherCardEntries.length, "outra compra prevista", "outras compras previstas")} no cartão
            </p>
          )}
        </Collapsible>

        <Collapsible
          view="oneOff"
          amount={oneOff.reduce((sum, entry) => sum + Math.abs(entry.amount), 0)}
          detail={count(oneOff.length, "conta", "contas")}
          openView={openView}
        >
          <Entries
            entries={oneOff}
            onEdit={(item) => setModal({ type: "entry", item })}
            empty="Nenhuma conta avulsa neste mês."
          />
        </Collapsible>

        {income.length > 0 && (
          <Collapsible
            view="income"
            amount={monthlyTotal(income)}
            detail={count(income.length, "receita", "receitas")}
            openView={openView}
            income
          >
            {rows.recurring(income)}
          </Collapsible>
        )}
      </div>
    </>
  );
}

/** Full screen for one kind of commitment: every rule, totals per year and the actions. */
export function CommitmentDetail({
  view,
  data,
  monthControl,
  setModal,
}: {
  view: CommitmentView;
  data: Dashboard;
  monthControl: ReactNode;
  setModal: OpenEditor;
}) {
  const { groups, plans, oneOff, otherCardEntries } = commitmentData(data);
  const rows = rowRenderers(data, setModal);
  const { title, addLabel, mode } = views[view];

  let detail: string | undefined;
  let body: ReactNode;
  if (view === "fixed" || view === "subscriptions" || view === "income") {
    const items = groups[view];
    const monthly = monthlyTotal(items);
    detail = items.length
      ? view === "subscriptions"
        ? `${money(monthly)} por mês · ${money(monthly * 12)} por ano`
        : `${money(monthly)} por mês`
      : undefined;
    body = items.length ? rows.recurring(items) : (
      <p className="empty">
        {view === "fixed"
          ? "Aluguel, internet, escola: contas que vencem todo mês aparecem aqui."
          : view === "subscriptions"
            ? "Cadastre streaming, apps e clubes para ver quanto custam no ano."
            : "Salário e outras receitas que entram todo mês aparecem aqui."}
      </p>
    );
  } else if (view === "installments") {
    const monthly = plans.reduce((sum, plan) => sum + plan.amount, 0);
    const left = plans.reduce((sum, plan) => sum + plan.leftAmount, 0);
    detail = plans.length ? `${money(monthly)} neste mês${left ? ` · faltam ${money(left)}` : ""}` : undefined;
    body = plans.length ? rows.installments(plans) : (
      <p className="empty">Nenhuma parcela neste mês. Compras parceladas importadas da fatura também aparecem aqui.</p>
    );
  } else if (view === "invoices") {
    body = (
      <>
        {data.invoices.length ? rows.invoices(data.invoices) : <div className="empty">Nenhuma fatura neste mês.</div>}
        {otherCardEntries.length > 0 && (
          <details className="form-details">
            <summary>Outras compras previstas no cartão ({otherCardEntries.length})</summary>
            <Entries entries={otherCardEntries} onEdit={(item) => setModal({ type: "entry", item })} />
          </details>
        )}
      </>
    );
  } else {
    detail = oneOff.length ? "Vencem só neste mês" : undefined;
    body = (
      <Entries
        entries={oneOff}
        onEdit={(item) => setModal({ type: "entry", item })}
        empty="Boletos e contas que vencem uma única vez, como IPVA ou matrícula."
      />
    );
  }

  return (
    <>
      <PageHeading
        title={title}
        description={detail}
        action={
          mode && (
            <button className="button screen-heading-action" onClick={() => setModal({ type: "commitment", mode })} aria-label={addLabel}>
              <Icon name="plus" size={16} /> <span>Adicionar</span>
            </button>
          )
        }
      />
      <div className="screen-stack commitments">
        <div className="commitment-detail-month">{monthControl}</div>
        <section className="panel screen-list commitment-section">{body}</section>
      </div>
    </>
  );
}

function rowRenderers(data: Dashboard, setModal: OpenEditor) {
  const cardName = (id?: string) => data.cards.find((card) => card.id === id)?.name;
  return {
    recurring: (items: RecurringItem[]) =>
      items.map((item) => (
        <RecurringRow
          key={item.rule.id}
          item={item}
          cardName={cardName(item.rule.cardId)}
          month={data.month}
          onOpen={() => setModal({ type: "recurrence", item: item.rule })}
        />
      )),
    installments: (plans: InstallmentPlan[], compact = false) =>
      plans.map((plan) => (
        <InstallmentRow
          key={plan.entry.id}
          plan={plan}
          compact={compact}
          cardName={cardName(plan.entry.cardId)}
          onOpen={() => setModal({ type: "entry", item: plan.entry })}
        />
      )),
    invoices: (invoices: Invoice[], compact = false) =>
      invoices.map((i) => {
        const card = data.cards.find(({ id }) => id === i.cardId);
        const bank = data.accounts.find(({ id }) => id === card?.accountId)?.name;
        return (
          <div className="commitment-invoice" key={i.cardId + i.month}>
            <div className="transaction">
              <BankIcon bank={bank} />
              <div className="transaction-info">
                <strong>{card?.name || "Cartão"}</strong>
                <span>
                  {[
                    card?.archived && "Cartão excluído",
                    !compact && i.closingDate && `Fecha ${dateLabel(i.closingDate)}`,
                    i.dueDate && `Vence ${dateLabel(i.dueDate)}`,
                    !compact && i.adjusted && "Datas ajustadas",
                    i.paid > 0 && `Pago ${money(i.paid)}`,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
              <span className="transaction-amount">{money(i.total)}</span>
            </div>
            {!compact && (
              <div className="commitment-invoice-actions">
                {!card?.archived && (
                  <button className="text-button" onClick={() => setModal({ type: "invoice-dates", item: i })}>
                    <Icon name="calendar" size={15} /> Editar datas
                  </button>
                )}
                {i.total > i.paid && (
                  <button className="text-button" onClick={() => setModal({ type: "settle", item: i })}>
                    Vincular pagamento
                  </button>
                )}
              </div>
            )}
          </div>
        );
      }),
  };
}

function Collapsible({
  view,
  amount,
  detail,
  income = false,
  openView,
  children,
}: {
  view: CommitmentView;
  amount: number;
  detail: string;
  income?: boolean;
  openView: (view: CommitmentView) => void;
  children: ReactNode;
}) {
  const { title, all } = views[view];
  return (
    <details className="panel commitment-section commitment-collapsible">
      <summary>
        <span className="commitment-collapsible-title">
          <strong>{title}</strong>
          <small>{detail} no mês</small>
        </span>
        <span className={`commitment-collapsible-amount${income ? " income" : ""}`}>
          {income && amount ? "+ " : ""}
          {money(amount)}
        </span>
        <Icon name="chevronRight" size={16} />
      </summary>
      <div className="commitment-collapsible-body screen-list">
        {children}
        <button className="text-button commitment-see-all" onClick={() => openView(view)}>
          {all} <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </details>
  );
}

function RecurringRow({
  item,
  cardName,
  month,
  onOpen,
}: {
  item: RecurringItem;
  cardName?: string;
  month: string;
  onOpen: () => void;
}) {
  const { rule, pending, started } = item;
  const income = rule.kind === "income";
  const status = !started
    ? `Começa em ${monthName(rule.startMonth)}`
    : pending
      ? `${income ? "Entra" : rule.cardId ? "Cobra" : "Vence"} ${dateLabel(pending.date)}`
      : income ? "Recebido neste mês" : rule.cardId ? "Lançado na fatura" : "Pago neste mês";
  // After the closing day, the charge is billed in a later invoice: say which one.
  const laterInvoice = pending?.invoiceMonth && pending.invoiceMonth !== month ? pending.invoiceMonth : undefined;
  const detail = [
    rule.cardId && (cardName ? cardLabel(cardName) : "Cartão excluído"),
    status,
    pending && rule.autoRecord && "lança sozinho",
    laterInvoice && `fatura de ${monthOnly(laterInvoice)}`,
    rule.endMonth && `até ${shortMonth(rule.endMonth)}`,
  ].filter(Boolean).join(" · ");
  const amount = money(Math.abs(rule.amount));
  return (
    <button
      className="transaction card-row commitment-row"
      onClick={onOpen}
      aria-label={`${rule.description}, ${amount} por mês, ${detail}. Editar`}
    >
      <EntryBadge entry={rule} />
      <span className="transaction-info">
        <strong>{rule.description}</strong>
        <span className={started && !pending ? "commitment-done" : undefined}>{detail}</span>
      </span>
      <span className={`transaction-amount${income ? " income" : ""}`}>{income ? `+ ${amount}` : amount}</span>
      <Icon name="chevronRight" size={15} />
    </button>
  );
}

function InstallmentRow({
  plan,
  cardName,
  compact,
  onOpen,
}: {
  plan: InstallmentPlan;
  cardName?: string;
  compact: boolean;
  onOpen: () => void;
}) {
  const { entry, number, count, amount, left, leftAmount, lastMonth } = plan;
  const progress = `Parcela ${number} de ${count}`;
  const remaining = left
    ? `Faltam ${left} · ${money(leftAmount)} até ${shortMonth(lastMonth)}`
    : "Última parcela";
  return (
    <button
      className="card-row commitment-installment"
      onClick={onOpen}
      aria-label={`${entry.description}, ${progress}, ${money(amount)}. ${remaining}. Editar parcela`}
    >
      <span className="transaction">
        <EntryBadge entry={entry} />
        <span className="transaction-info">
          <strong>{entry.description}</strong>
          <span>{[cardName, progress].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="transaction-amount">{money(amount)}</span>
      </span>
      {!compact && (
        <>
          <span className="commitment-progress" aria-hidden="true">
            <i style={{ width: `${(number / count) * 100}%` }} />
          </span>
          <span className={`commitment-remaining${left ? "" : " is-last"}`}>{remaining}</span>
        </>
      )}
    </button>
  );
}
