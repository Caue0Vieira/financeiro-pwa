import type { CSSProperties } from "react";
import type { Dashboard } from "../../contracts";
import { brandName } from "../brand";
import { cardDesign, findBank, type Bank, type CardDesign } from "./BankIcon";

type FaceStyle = CSSProperties & Record<"--card-from" | "--card-to" | "--card-ink", string> & { "--card-detail"?: string };

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** CSS variables that paint a card face (see .home-card-art[data-bank] and .card-model). */
export function faceStyle({ face: [from, to, ink, detail] }: CardDesign): FaceStyle {
  return { "--card-from": from, "--card-to": to, "--card-ink": ink, ...(detail && { "--card-detail": detail }) };
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
  const current = cardDesign(bank, value).id;
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
          <span className="card-model-face" data-detail={design.face[3] ? "" : undefined} style={faceStyle(design)}>
            <img src={bank.image} alt="" />
          </span>
          <span>{design.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The card on the balance hero: the user's next card to come due, drawn as its bank's chosen
 * model with the bank logo, and up to two more cards stacked behind it.
 * Without cards it falls back to the app's own glass card.
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
          data-bank={design ? "" : undefined}
          data-depth={list.length - index}
          style={design && faceStyle(design)}
          aria-hidden="true"
        />
      ))}
      <div
        className="home-card-art"
        data-bank={front.design ? "" : undefined}
        data-detail={front.design?.face[3] ? "" : undefined}
        style={front.design && faceStyle(front.design)}
        aria-hidden="true"
      >
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
