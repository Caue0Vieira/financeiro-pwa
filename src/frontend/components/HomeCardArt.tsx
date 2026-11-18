import type { Dashboard } from "../../contracts";
import { brandName } from "../brand";
import { cardDesign, findBank, type Bank, type CardDesign } from "./BankIcon";

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Printed details of a card model, drawn in CSS from a photo of the real card. */
function CardPrint({ design }: { design: CardDesign }) {
  switch (design.id) {
    case "inter-prime":
      return (
        <>
          <span className="ip-brand">
            <span className="ip-mark">
              <span className="ip-stripes"><i /><i /><i /><i /></span>
              <b>inter</b>
            </span>
            <small>prime</small>
          </span>
          <span className="card-chip-metal" />
          <span className="card-network"><i /><i /></span>
        </>
      );
    default:
      return null;
  }
}

/** Radio group of mini cards to choose the model of a bank's card. */
export function CardModelPicker({
  bank,
  value,
  onChange,
}: {
  bank: Bank;
  value: string | null;
  onChange: (design: string) => void;
}) {
  const current = cardDesign(bank, value)?.id;
  return (
    <div className="card-models" role="radiogroup" aria-label="Modelo do cartão">
      {bank.designs.map((design) => (
        <button
          key={design.id}
          type="button"
          role="radio"
          aria-checked={design.id === current}
          className="card-model"
          onClick={() => onChange(design.id)}
        >
          <span className="card-model-face" data-art={design.id}>
            <CardPrint design={design} />
          </span>
          <span>{design.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The card on the balance hero: the user's next card to come due and up to two more stacked
 * behind it. A bank with a drawn model shows that card; other banks show the app's glass card
 * with the bank logo. Without cards it falls back to the app's own glass card.
 */
export function HomeCardArt({ data }: { data: Pick<Dashboard, "cards" | "accounts" | "invoices"> }) {
  const cards = data.cards
    .filter((card) => !card.archived)
    .map((card) => {
      const bankName = data.accounts.find(({ id }) => id === card.accountId)?.name;
      const bank = findBank(bankName) ?? findBank(card.name);
      const invoice = data.invoices.find(({ cardId }) => cardId === card.id);
      return { card, bank, design: bank && cardDesign(bank, card.design), dueDate: invoice?.dueDate ?? null };
    })
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.card.name.localeCompare(b.card.name));

  if (cards.length === 0) {
    return (
      <div className="home-card-art" aria-hidden="true">
        <span className="home-card-chip" />
        <span className="home-card-signature">
          <i />
          <b>{brandName}</b>
        </span>
      </div>
    );
  }

  const [front, ...behind] = cards;
  return (
    <>
      {behind.slice(0, 2).reverse().map(({ card, design }, index, list) => (
        <span
          key={card.id}
          className="home-card-art home-card-back"
          data-art={design?.id}
          data-depth={list.length - index}
          aria-hidden="true"
        />
      ))}
      <div className="home-card-art" data-art={front.design?.id} aria-hidden="true">
        {front.design ? (
          <CardPrint design={front.design} />
        ) : (
          <span className="home-card-top">
            <span className="home-card-chip" />
            {front.bank && <img className="home-card-logo" src={front.bank.image} alt="" />}
          </span>
        )}
        <span className="home-card-signature home-card-details">
          <b>{front.card.name}</b>
          {front.dueDate && <small>Vence {shortDate(front.dueDate)}</small>}
        </span>
      </div>
    </>
  );
}
