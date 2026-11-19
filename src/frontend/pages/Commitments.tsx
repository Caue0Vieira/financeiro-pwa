import type { ReactNode } from "react";
import type { Dashboard } from "../../contracts";
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
import type { CommitmentMode, OpenEditor } from "../types";

const parts: { id: keyof MonthBreakdown; label: string }[] = [
  { id: "fixed", label: "Contas fixas" },
  { id: "subscriptions", label: "Assinaturas" },
  { id: "invoices", label: "Faturas do cartão" },
  { id: "oneOff", label: "Outras contas" },
];

const monthOnly = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "");

const shortMonth = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    .replace(".", "")
    .replace(" de ", " ");

export default function Commitments({
  data,
  monthControl,
  setModal,
}: {
  data: Dashboard;
  monthControl: ReactNode;
  setModal: OpenEditor;
}) {
  const groups = recurringGroups(data, data.month);
  const plans = installmentPlans(data.installments);
  const breakdown = monthBreakdown(data);
  const oneOff = oneOffEntries(data.upcoming);
  // Installments and recurring card charges already have their own sections.
  const otherCardEntries = data.upcoming.filter(
    (entry) => entry.cardId && !entry.installmentCount && !entry.recurrenceId,
  );
  const breakdownTotal = parts.reduce((sum, { id }) => sum + breakdown[id], 0);
  const create = (mode: CommitmentMode) => () => setModal({ type: "commitment", mode });
  const subscriptionsMonthly = monthlyTotal(groups.subscriptions);
  const installmentsMonthly = plans.reduce((sum, plan) => sum + plan.amount, 0);
  const installmentsLeft = plans.reduce((sum, plan) => sum + plan.leftAmount, 0);

  const recurringRows = (items: RecurringItem[]) =>
    items.map((item) => (
      <RecurringRow
        key={item.rule.id}
        item={item}
        cardName={data.cards.find(({ id }) => id === item.rule.cardId)?.name}
        month={data.month}
        onOpen={() => setModal({ type: "recurrence", item: item.rule })}
      />
    ));

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

        <Section
          title="Contas fixas"
          detail={groups.fixed.length ? `${money(monthlyTotal(groups.fixed))} por mês` : undefined}
          addLabel="Adicionar conta fixa"
          onAdd={create("monthly")}
        >
          {groups.fixed.length ? recurringRows(groups.fixed) : (
            <p className="empty">Aluguel, internet, escola: contas que vencem todo mês aparecem aqui.</p>
          )}
        </Section>

        <Section
          title="Assinaturas"
          detail={
            groups.subscriptions.length
              ? `${money(subscriptionsMonthly)} por mês · ${money(subscriptionsMonthly * 12)} por ano`
              : undefined
          }
          addLabel="Adicionar assinatura"
          onAdd={create("subscription")}
        >
          {groups.subscriptions.length ? recurringRows(groups.subscriptions) : (
            <p className="empty">Cadastre streaming, apps e clubes para ver quanto custam no ano.</p>
          )}
        </Section>

        <Section
          title="Compras parceladas"
          detail={
            plans.length
              ? `${money(installmentsMonthly)} neste mês${installmentsLeft ? ` · faltam ${money(installmentsLeft)}` : ""}`
              : undefined
          }
          addLabel="Adicionar compra parcelada"
          onAdd={create("installments")}
        >
          {plans.length ? plans.map((plan) => (
            <InstallmentRow
              key={plan.entry.id}
              plan={plan}
              cardName={data.cards.find(({ id }) => id === plan.entry.cardId)?.name}
              onOpen={() => setModal({ type: "entry", item: plan.entry })}
            />
          )) : (
            <p className="empty">Nenhuma parcela neste mês. Compras parceladas importadas da fatura também aparecem aqui.</p>
          )}
        </Section>

        <section className="panel screen-list">
          <header className="panel-head"><h2>Faturas do cartão</h2></header>
          {data.invoices.length ? (
            data.invoices.map((i) => {
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
                        i.closingDate && `Fecha ${dateLabel(i.closingDate)}`,
                        i.dueDate && `Vence ${dateLabel(i.dueDate)}`,
                        i.adjusted && "Datas ajustadas",
                        i.paid > 0 && `Pago ${money(i.paid)}`,
                      ].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <span className="transaction-amount">{money(i.total)}</span>
                  </div>
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
                </div>
              );
            })
          ) : (
            <div className="empty">Nenhuma fatura neste mês.</div>
          )}
          {otherCardEntries.length > 0 && (
            <details className="form-details">
              <summary>Outras compras previstas no cartão ({otherCardEntries.length})</summary>
              <Entries entries={otherCardEntries} onEdit={(item) => setModal({ type: "entry", item })} />
            </details>
          )}
        </section>

        <Section
          title="Contas avulsas"
          detail={oneOff.length ? "Vencem só neste mês" : undefined}
          addLabel="Adicionar conta avulsa"
          onAdd={create("once")}
        >
          <Entries
            entries={oneOff}
            onEdit={(item) => setModal({ type: "entry", item })}
            empty="Boletos e contas que vencem uma única vez, como IPVA ou matrícula."
          />
        </Section>

        {groups.income.length > 0 && (
          <Section title="Receitas fixas" detail={`${money(monthlyTotal(groups.income))} por mês`}>
            {recurringRows(groups.income)}
          </Section>
        )}
      </div>
    </>
  );
}

function Section({
  title,
  detail,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  detail?: string;
  addLabel?: string;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="panel screen-list commitment-section">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {detail && <p>{detail}</p>}
        </div>
        {onAdd && (
          <button className="icon-button" onClick={onAdd} aria-label={addLabel} title={addLabel}>
            <Icon name="plus" size={19} />
          </button>
        )}
      </header>
      {children}
    </section>
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

function InstallmentRow({ plan, cardName, onOpen }: { plan: InstallmentPlan; cardName?: string; onOpen: () => void }) {
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
      <span className="commitment-progress" aria-hidden="true">
        <i style={{ width: `${(number / count) * 100}%` }} />
      </span>
      <span className={`commitment-remaining${left ? "" : " is-last"}`}>{remaining}</span>
    </button>
  );
}
