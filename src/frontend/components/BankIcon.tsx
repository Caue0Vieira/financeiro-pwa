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
 * A card model of a bank, drawn as a stylised face: gradient start/end, the text colour
 * that reads on it, and an optional detail colour (edge highlight on dark premium cards).
 */
export type CardDesign = { id: string; label: string; face: [from: string, to: string, ink: string, detail?: string] };
export type Bank = { name: string; image: string; match: RegExp; designs: [CardDesign, ...CardDesign[]] };

const black = (detail: string, label = "Black"): CardDesign =>
  ({ id: "black", label, face: ["#3a3a3c", "#050505", "#ffffff", detail] });

const banks: Bank[] = [
  {
    name: "Banco Inter", image: inter, match: /^(banco )?inter\b/,
    designs: [
      { id: "gold", label: "Gold", face: ["#ff8f1f", "#f05a00", "#ffffff"] },
      { id: "platinum", label: "Platinum", face: ["#a7adb5", "#59606a", "#ffffff", "#ff7a00"] },
      { id: "prime", label: "Prime", face: ["#43474e", "#15171b", "#ffffff", "#ff7a00"] },
      black("#ff7a00"),
    ],
  },
  {
    name: "Nubank", image: nubank, match: /^(nubank|nu pagamentos)\b/,
    designs: [
      { id: "roxinho", label: "Roxinho", face: ["#9b3ee6", "#560ea0", "#ffffff"] },
      { id: "ultravioleta", label: "Ultravioleta", face: ["#3b1466", "#0b0216", "#ffffff", "#b77cff"] },
    ],
  },
  {
    name: "Itaú", image: itau, match: /^(banco )?itau\b/,
    designs: [
      { id: "laranja", label: "Itaú", face: ["#ff8a1f", "#d95400", "#ffffff"] },
      { id: "uniclass", label: "Uniclass", face: ["#2a3d9e", "#0b1655", "#ffffff"] },
      { id: "personnalite", label: "Personnalité", face: ["#2e2e30", "#070707", "#efe1b4", "#c9a85a"] },
    ],
  },
  {
    name: "Santander", image: santander, match: /^(banco )?santander\b/,
    designs: [
      { id: "vermelho", label: "Santander", face: ["#f2271f", "#a8000b", "#ffffff"] },
      black("#ec0000", "Unique"),
    ],
  },
  {
    name: "Banco do Brasil", image: bb, match: /^(banco do brasil|bb)\b/,
    designs: [
      { id: "ourocard", label: "Ourocard", face: ["#fff04d", "#f5c400", "#0b3a9c"] },
      { id: "azul", label: "Azul", face: ["#2457c5", "#0b2a78", "#fff04d"] },
      black("#f5d23a", "Altus"),
    ],
  },
  {
    name: "Bradesco", image: bradesco, match: /^(banco )?bradesco\b/,
    designs: [
      { id: "vermelho", label: "Bradesco", face: ["#e5194a", "#8f0026", "#ffffff"] },
      { id: "prime", label: "Prime", face: ["#2a3346", "#0b0f19", "#ffffff", "#e5194a"] },
    ],
  },
  {
    name: "Caixa", image: caixa, match: /^caixa\b/,
    designs: [
      { id: "azul", label: "Caixa", face: ["#2276d8", "#003f8a", "#ffffff", "#f39200"] },
      black("#f39200"),
    ],
  },
  {
    name: "C6 Bank", image: c6, match: /^(banco )?c6\b/,
    designs: [
      { id: "grafite", label: "Grafite", face: ["#3a3a3a", "#0d0d0d", "#ffffff"] },
      { id: "carbon", label: "Carbon", face: ["#1d1d1f", "#000000", "#ffffff", "#8a8a8a"] },
      { id: "amarelo", label: "Amarelo", face: ["#ffe14d", "#f2b705", "#111111"] },
      { id: "verde", label: "Verde", face: ["#3ddc97", "#0d8a5b", "#ffffff"] },
      { id: "rosa", label: "Rosa", face: ["#ff8fc1", "#e23d8b", "#ffffff"] },
      { id: "azul", label: "Azul", face: ["#5aa9ff", "#1d5fd6", "#ffffff"] },
    ],
  },
  {
    name: "BTG Pactual", image: btg, match: /^(banco )?btg\b/,
    designs: [
      { id: "azul", label: "BTG", face: ["#16397a", "#04122b", "#ffffff"] },
      black("#4f8cff"),
    ],
  },
  { name: "Sicoob", image: sicoob, match: /^(banco )?sicoob\b/, designs: [{ id: "padrao", label: "Sicoob", face: ["#00a99d", "#003641", "#ffffff"] }] },
  { name: "Sicredi", image: sicredi, match: /^(banco )?sicredi\b/, designs: [{ id: "padrao", label: "Sicredi", face: ["#6cc240", "#2a7a1a", "#ffffff"] }] },
  { name: "Neon", image: neon, match: /^(banco )?neon\b/, designs: [{ id: "padrao", label: "Neon", face: ["#22d6ff", "#0070e0", "#ffffff"] }] },
  { name: "Mercado Pago", image: mercadoPago, match: /^mercado pago\b/, designs: [{ id: "padrao", label: "Mercado Pago", face: ["#3fc6f2", "#0a8bd0", "#ffffff"] }] },
];

export const bankSuggestions = banks.map(({ name }) => name);

export function findBank(name?: string): Bank | undefined {
  const normalized = name?.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return normalized ? banks.find(({ match }) => match.test(normalized)) : undefined;
}

/** The chosen model of a bank's card, or its first (standard) model. */
export function cardDesign(bank: Bank, id?: string | null): CardDesign {
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
