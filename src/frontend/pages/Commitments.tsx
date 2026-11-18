import type { ReactNode } from "react";
import type { Dashboard } from "../../contracts";
import { BankIcon } from "../components/BankIcon";
import { Entries, Icon, PageHeading } from "../components/common";
import { dateLabel, money, monthName } from "../format";
import type { OpenEditor } from "../types";

export default function Commitments({
  data,
  monthControl,
  setModal,
}: {
  data: Dashboard;
  monthControl: ReactNode;
  setModal: OpenEditor;
}) {
  const upcoming = [...data.upcoming].sort((a, b) => a.date.localeCompare(b.date));
  const plannedEntries = upcoming.filter((entry) => !entry.cardId);
  const plannedCardEntries = upcoming.filter((entry) => entry.cardId);
  const editEntry = (item: Dashboard["upcoming"][number]) => setModal({ type: "entry", item });

  return (
    <>
      <PageHeading
        title="Compromissos"
        action={
          <button className="button" onClick={() => setModal({ type: "commitment" })}>
            <Icon name="plus" size={16} /> Novo compromisso
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
        </section>
        <section className="panel screen-list">
          <header className="panel-head"><h2>Lançamentos previstos</h2></header>
          <Entries entries={plannedEntries} onEdit={editEntry} empty="Nenhum lançamento previsto para este mês." />
        </section>
        <section className="panel screen-list">
          <header className="panel-head"><h2>Faturas do mês</h2></header>
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
          {plannedCardEntries.length > 0 && (
            <details className="form-details">
              <summary>Compras previstas no cartão ({plannedCardEntries.length})</summary>
              <Entries entries={plannedCardEntries} onEdit={editEntry} />
            </details>
          )}
        </section>
        <details className="panel commitments-recurring">
          <summary>Gerenciar recorrências ({data.recurrences.length})</summary>
          {data.recurrences.length ? data.recurrences.map((rule) => (
            <button className="transaction card-row" key={rule.id} onClick={() => setModal({ type: "recurrence", item: rule })}>
              <span className="transaction-icon tone-mint"><Icon name="repeat" /></span>
              <span className="transaction-info">
                <strong>{rule.description}</strong>
                <span>Dia {rule.day}{rule.endMonth && ` · Até ${monthName(rule.endMonth)}`}</span>
              </span>
              <span className={`transaction-amount${rule.amount > 0 ? " income" : ""}`}>{money(rule.amount)}</span>
              <Icon name="chevronRight" size={15} />
            </button>
          )) : <p className="empty">Nenhuma recorrência cadastrada.</p>}
        </details>
      </div>
    </>
  );
}
