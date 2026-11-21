import type { Account, Card, Invoice } from "../../contracts";
import { BankIcon } from "../components/BankIcon";
import { Icon, PageHeading } from "../components/common";
import { money, monthName } from "../format";
import type { OpenEditor } from "../types";

const syncedLabel = (iso: string) => {
  const date = new Date(iso);
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return `Atualizado em ${day} às ${time}`;
};

/** Banks (app accounts) with the balance Open Finance reports, and the cards of each one inside. */
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
  const banks = accounts
    .map((account) => ({ account, cards: cards.filter((card) => card.accountId === account.id) }))
    .filter(({ account, cards }) => cards.length > 0 || account.balance !== undefined);
  const loose = cards.filter((card) => !accounts.some(({ id }) => id === card.accountId));
  const total = banks.reduce((sum, { account }) => sum + (account.balance ?? 0), 0);
  const withBalance = banks.filter(({ account }) => account.balance !== undefined).length;

  const cardEntry = (card: Card, bank?: string) => {
    const details = [
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
          <span className="bank-card-icon" aria-hidden="true">
            <Icon name="card" size={17} />
          </span>
          <span className="transaction-info">
            <strong>{card.name !== bank ? card.name : "Cartão de crédito"}</strong>
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
  };

  return (
    <>
      <PageHeading
        title="Bancos"
        action={
          <button className="button" onClick={() => openEditor({ type: "card-picker" })}>
            <Icon name="plus" size={16} /> Adicionar cartão
          </button>
        }
      />
      {withBalance > 1 && (
        <section className="panel bank-total" aria-label="Saldo somado dos bancos">
          <span>Saldo em todos os bancos</span>
          <strong className={total < 0 ? "negative" : undefined}>{money(total)}</strong>
        </section>
      )}
      {banks.length === 0 && loose.length === 0 && (
        <section className="panel">
          <p className="empty">Adicione um cartão e escolha o banco dele. Conectando o banco pelo Open Finance, o saldo da conta aparece aqui.</p>
        </section>
      )}
      {banks.map(({ account, cards: bankCards }) => (
        <section className="panel screen-list bank-group" key={account.id} aria-label={account.name}>
          <header className="bank-head">
            <BankIcon bank={account.name} />
            <span className="transaction-info">
              <strong>{account.name}</strong>
              <span>
                {account.balanceSyncedAt ? syncedLabel(account.balanceSyncedAt)
                  : account.balance === undefined ? "Saldo disponível com o Open Finance" : "Saldo em conta"}
              </span>
            </span>
            {account.balance !== undefined && (
              <strong className={`bank-balance${account.balance < 0 ? " negative" : ""}`}>{money(account.balance)}</strong>
            )}
          </header>
          {bankCards.map((card) => cardEntry(card, account.name))}
        </section>
      ))}
      {loose.length > 0 && (
        <section className="panel screen-list bank-group" aria-label="Cartões sem banco">
          <header className="bank-head">
            <span className="transaction-info">
              <strong>Cartões sem banco</strong>
              <span>Abra o cartão para escolher o banco dele.</span>
            </span>
          </header>
          {loose.map((card) => cardEntry(card))}
        </section>
      )}
    </>
  );
}
