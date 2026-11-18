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

const banks = [
  { name: "Banco Inter", image: inter, match: /^(banco )?inter\b/ },
  { name: "Nubank", image: nubank, match: /^(nubank|nu pagamentos)\b/ },
  { name: "Itaú", image: itau, match: /^(banco )?itau\b/ },
  { name: "Santander", image: santander, match: /^(banco )?santander\b/ },
  { name: "Banco do Brasil", image: bb, match: /^(banco do brasil|bb)\b/ },
  { name: "Bradesco", image: bradesco, match: /^(banco )?bradesco\b/ },
  { name: "Caixa", image: caixa, match: /^caixa\b/ },
  { name: "C6 Bank", image: c6, match: /^(banco )?c6\b/ },
  { name: "BTG Pactual", image: btg, match: /^(banco )?btg\b/ },
  { name: "Sicoob", image: sicoob, match: /^(banco )?sicoob\b/ },
  { name: "Sicredi", image: sicredi, match: /^(banco )?sicredi\b/ },
  { name: "Neon", image: neon, match: /^(banco )?neon\b/ },
  { name: "Mercado Pago", image: mercadoPago, match: /^mercado pago\b/ },
];

export const bankSuggestions = banks.map(({ name }) => name);

export function BankIcon({ bank }: { bank?: string }) {
  const normalized = bank?.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const logo = normalized && banks.find(({ match }) => match.test(normalized));
  return (
    <span className={`transaction-icon ${logo ? "bank-icon" : "tone-mint"}`}>
      {logo ? <img src={logo.image} alt="" /> : <Icon name={bank ? "bank" : "card"} />}
    </span>
  );
}
