import type { Account, Card } from "../../contracts";
import { BankIcon } from "../components/BankIcon";
import { Icon, PageHeading } from "../components/common";
import type { OpenEditor } from "../types";

export default function Cards({
  cards,
  accounts,
  openEditor,
}: {
  cards: readonly Card[];
  accounts: readonly Account[];
  openEditor: OpenEditor;
}) {
  return (
    <>
      <PageHeading
        title="Cartões"
        action={
          <button className="button" onClick={() => openEditor({ type: "card" })}>
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
            card.dueDay !== null && `Vence dia ${card.dueDay}`,
          ].filter(Boolean).join(" · ");

          return (
            <button
              className="transaction card-row"
              key={card.id}
              onClick={() => openEditor({ type: "card", item: card })}
            >
              <BankIcon bank={bank} />
              <span className="transaction-info">
                <strong>{card.name}</strong>
                {details && <span>{details}</span>}
              </span>
              <Icon name="chevronRight" size={16} />
            </button>
          );
        })}
      </section>
    </>
  );
}
