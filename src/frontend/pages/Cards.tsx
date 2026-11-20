import type { Account, Card, Invoice } from "../../contracts";
import { BankIcon } from "../components/BankIcon";
import { Icon, PageHeading } from "../components/common";
import { money, monthName } from "../format";
import type { OpenEditor } from "../types";

export default function Cards({
  cards,
  accounts,
  invoices,
  month,
  openEditor,
}: {
  cards: readonly Card[];
  accounts: readonly Account[];
  invoices: readonly Invoice[];
  month: string;
  openEditor: OpenEditor;
}) {
  return (
    <>
      <PageHeading
        title="Cartões"
        action={
          <button className="button" onClick={() => openEditor({ type: "card-picker" })}>
            <Icon name="plus" size={16} /> Adicionar cartão
          </button>
        }
      />
      <section className="panel screen-list" aria-label="Cartões cadastrados">
        {cards.length === 0 && <p className="empty">Adicione um cartão e escolha se ele tem vínculo com um banco.</p>}
        {cards.map((card) => {
          const bank = accounts.find(({ id }) => id === card.accountId)?.name;
          const details = [
            bank && bank !== card.name && bank,
            !bank && "Avulso",
            card.closingDay !== null && `Fecha dia ${card.closingDay}`,
            card.dueDay === null ? "Definir vencimento" : `Vence dia ${card.dueDay}`,
          ].filter(Boolean).join(" · ");
          const spent = invoices.find((invoice) => invoice.cardId === card.id)?.total ?? 0;
          const hasLimit = card.creditLimit !== undefined && card.creditLimit > 0;
          const available = Math.max(card.availableLimit ?? 0, 0);
          const used = hasLimit ? Math.min(Math.max(1 - available / card.creditLimit!, 0), 1) : 0;

          return (
            <div className="card-entry" key={card.id}>
              <button className="transaction card-row" onClick={() => openEditor({ type: "card", item: card })}>
                <BankIcon bank={bank} />
                <span className="transaction-info">
                  <strong>{card.name}</strong>
                  {details && <span>{details}</span>}
                </span>
                <Icon name="chevronRight" size={16} />
              </button>
              <dl className="card-stats">
                <div>
                  <dt>Gasto em {monthName(month).split(" de ")[0]}</dt>
                  <dd>{money(spent)}</dd>
                </div>
                {card.billBalance !== undefined && (
                  <div>
                    <dt>Fatura atual no banco</dt>
                    <dd>{money(card.billBalance)}</dd>
                  </div>
                )}
                {hasLimit && (
                  <div className="card-limit">
                    <dt>Limite disponível</dt>
                    <dd>
                      {money(available)} <small>de {money(card.creditLimit!)}</small>
                    </dd>
                    <span className="card-limit-bar" aria-hidden="true">
                      <span style={{ width: `${Math.round(used * 100)}%` }} />
                    </span>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </section>
    </>
  );
}
