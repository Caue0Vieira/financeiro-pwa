import bb from "../assets/banks/bb.png";
import bradesco from "../assets/banks/bradesco.png";
import btg from "../assets/banks/btg.png";
import c6 from "../assets/banks/c6.png";
import caixa from "../assets/banks/caixa.png";
import inter from "../assets/banks/inter.png";
import itau from "../assets/banks/itau.png";
import mercadoPago from "../assets/banks/mercado-pago.png";
import neon from "../assets/banks/neon.png";
import nubank from "../assets/banks/nubank.png";
import santander from "../assets/banks/santander.png";
import sicoob from "../assets/banks/sicoob.png";
import sicredi from "../assets/banks/sicredi.png";
import { Icon } from "./common";

/**
 * Card models drawn by the app, each recreated from a photo of the real card
 * (see .home-card-art[data-art]). Banks without models use the app's glass card with their logo.
 */
export type CardDesign = { id: string; label: string };
export type Bank = { name: string; image: string; match: RegExp; designs: CardDesign[] };

const banks: Bank[] = [
  { name: "Banco Inter", image: inter, match: /^(banco )?inter\b/, designs: [{ id: "inter-prime", label: "Inter Prime" }] },
  { name: "Nubank", image: nubank, match: /^(nubank|nu pagamentos)\b/, designs: [] },
  { name: "Itaú", image: itau, match: /^(banco )?itau\b/, designs: [] },
  { name: "Santander", image: santander, match: /^(banco )?santander\b/, designs: [] },
  { name: "Banco do Brasil", image: bb, match: /^(banco do brasil|bb)\b/, designs: [] },
  { name: "Bradesco", image: bradesco, match: /^(banco )?bradesco\b/, designs: [] },
  { name: "Caixa", image: caixa, match: /^caixa\b/, designs: [] },
  { name: "C6 Bank", image: c6, match: /^(banco )?c6\b/, designs: [] },
  { name: "BTG Pactual", image: btg, match: /^(banco )?btg\b/, designs: [] },
  { name: "Sicoob", image: sicoob, match: /^(banco )?sicoob\b/, designs: [] },
  { name: "Sicredi", image: sicredi, match: /^(banco )?sicredi\b/, designs: [] },
  { name: "Neon", image: neon, match: /^(banco )?neon\b/, designs: [] },
  { name: "Mercado Pago", image: mercadoPago, match: /^mercado pago\b/, designs: [] },
];

export const bankSuggestions = banks.map(({ name }) => name);

export function findBank(name?: string): Bank | undefined {
  const normalized = name?.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return normalized ? banks.find(({ match }) => match.test(normalized)) : undefined;
}

/** The chosen model of a bank's card, or its first model; undefined when the bank has none. */
export function cardDesign(bank: Bank, id?: string | null): CardDesign | undefined {
  return bank.designs.find((design) => design.id === id) ?? bank.designs[0];
}

export function BankIcon({ bank }: { bank?: string }) {
  const logo = findBank(bank);
  return (
    <span className={`transaction-icon ${logo ? "bank-icon" : "tone-mint"}`}>
      {logo ? <img src={logo.image} alt="" /> : <Icon name={bank ? "bank" : "card"} />}
    </span>
  );
}
