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

/** `card` is the card face: gradient start/end and the text colour that reads on it. */
export type Bank = { name: string; image: string; match: RegExp; card: [from: string, to: string, ink: string] };

const banks: Bank[] = [
  { name: "Banco Inter", image: inter, match: /^(banco )?inter\b/, card: ["#ff8f1f", "#f05a00", "#ffffff"] },
  { name: "Nubank", image: nubank, match: /^(nubank|nu pagamentos)\b/, card: ["#9b3ee6", "#560ea0", "#ffffff"] },
  { name: "Itaú", image: itau, match: /^(banco )?itau\b/, card: ["#2a3d9e", "#0b1655", "#ffffff"] },
  { name: "Santander", image: santander, match: /^(banco )?santander\b/, card: ["#f2271f", "#a8000b", "#ffffff"] },
  { name: "Banco do Brasil", image: bb, match: /^(banco do brasil|bb)\b/, card: ["#fff04d", "#f5c400", "#0b3a9c"] },
  { name: "Bradesco", image: bradesco, match: /^(banco )?bradesco\b/, card: ["#e5194a", "#8f0026", "#ffffff"] },
  { name: "Caixa", image: caixa, match: /^caixa\b/, card: ["#2276d8", "#003f8a", "#ffffff"] },
  { name: "C6 Bank", image: c6, match: /^(banco )?c6\b/, card: ["#3a3a3a", "#050505", "#ffffff"] },
  { name: "BTG Pactual", image: btg, match: /^(banco )?btg\b/, card: ["#16397a", "#04122b", "#ffffff"] },
  { name: "Sicoob", image: sicoob, match: /^(banco )?sicoob\b/, card: ["#00a99d", "#003641", "#ffffff"] },
  { name: "Sicredi", image: sicredi, match: /^(banco )?sicredi\b/, card: ["#6cc240", "#2a7a1a", "#ffffff"] },
  { name: "Neon", image: neon, match: /^(banco )?neon\b/, card: ["#22d6ff", "#0070e0", "#ffffff"] },
  { name: "Mercado Pago", image: mercadoPago, match: /^mercado pago\b/, card: ["#3fc6f2", "#0a8bd0", "#ffffff"] },
];

export const bankSuggestions = banks.map(({ name }) => name);

export function findBank(name?: string): Bank | undefined {
  const normalized = name?.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return normalized ? banks.find(({ match }) => match.test(normalized)) : undefined;
}

export function BankIcon({ bank }: { bank?: string }) {
  const logo = findBank(bank);
  return (
    <span className={`transaction-icon ${logo ? "bank-icon" : "tone-mint"}`}>
      {logo ? <img src={logo.image} alt="" /> : <Icon name={bank ? "bank" : "card"} />}
    </span>
  );
}
