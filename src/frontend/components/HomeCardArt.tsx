import type { CSSProperties } from "react";
import type { Dashboard } from "../../contracts";
import { brandName } from "../brand";
import { findBank } from "./BankIcon";

type CardFace = CSSProperties & Record<"--card-from" | "--card-to" | "--card-ink", string>;

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * The card on the balance hero: the user's next card to come due, drawn in its bank's
 * colours with the bank logo, and up to two more cards stacked behind it.
 * Without cards it falls back to the app's own glass card.
 */
export function HomeCardArt({ data }: { data: Pick<Dashboard, "cards" | "accounts" | "invoices"> }) {
  const cards = data.cards
    .filter((card) => !card.archived)
    .map((card) => {
      const bankName = data.accounts.find(({ id }) => id === card.accountId)?.name;
      const invoice = data.invoices.find(({ cardId }) => cardId === card.id);
      return { card, bank: findBank(bankName) ?? findBank(card.name), dueDate: invoice?.dueDate ?? null };
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

  const face = (bank: (typeof cards)[number]["bank"]): CardFace | undefined =>
    bank && { "--card-from": bank.card[0], "--card-to": bank.card[1], "--card-ink": bank.card[2] };
  const [front, ...behind] = cards;

  return (
    <>
      {behind.slice(0, 2).reverse().map(({ card, bank }, index, list) => (
        <span
          key={card.id}
          className="home-card-art home-card-back"
          data-bank={bank ? "" : undefined}
          data-depth={list.length - index}
          style={face(bank)}
          aria-hidden="true"
        />
      ))}
      <div className="home-card-art" data-bank={front.bank ? "" : undefined} style={face(front.bank)} aria-hidden="true">
        <span className="home-card-top">
          <span className="home-card-chip" />
          {front.bank && <img className="home-card-logo" src={front.bank.image} alt="" />}
        </span>
        <span className="home-card-signature home-card-details">
          <b>{front.card.name}</b>
          {front.dueDate && <small>Vence {shortDate(front.dueDate)}</small>}
        </span>
      </div>
    </>
  );
}
