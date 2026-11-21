import assert from "node:assert/strict";
import { test } from "node:test";
import { entriesCsv, monthPdf, monthTotals } from "./exports.ts";
import { fit, PdfDocument, textWidth } from "./pdf.ts";

const names = { accounts: [{ id: "conta", name: "Banco Inter" }], cards: [{ id: "nu", name: "Nubank", closingDay: 3, dueDay: 10 }] };
const entries = [
  { id: "1", date: "2026-11-05", description: "Salário", amount: 600000, kind: "income", category: "Salário", status: "confirmed", source: "manual", accountId: "conta" },
  { id: "2", date: "2026-11-07", description: 'Aluguel "apto; 12"', amount: -188000, kind: "expense", category: "Moradia", status: "confirmed", source: "manual", accountId: "conta", tags: ["casa", "fixo"] },
  { id: "3", date: "2026-11-02", description: "TV", amount: -40000, kind: "expense", category: "Compras", status: "confirmed", source: "installment", cardId: "nu", invoiceMonth: "2026-12", installmentNumber: 2, installmentCount: 10 },
  { id: "4", date: "2026-11-25", description: "Energia", amount: -16340, kind: "expense", category: "Moradia", status: "planned", source: "manual" },
];

test("CSV for a Portuguese spreadsheet: BOM, semicolons, decimal comma, quoted fields, oldest first", () => {
  const csv = entriesCsv(entries, names);
  assert.ok(csv.startsWith("﻿Data;Descrição;Valor;Tipo;Categoria;Situação;Conta ou cartão;Fatura;Parcela;Tags\r\n"));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[1], "02/11/2026;TV;-400,00;Despesa;Compras;Confirmado;Nubank;12/2026;2/10;");
  assert.equal(lines[3], '07/11/2026;"Aluguel ""apto; 12""";-1880,00;Despesa;Moradia;Confirmado;Banco Inter;;;casa, fixo');
  assert.equal(lines[4], "25/11/2026;Energia;-163,40;Despesa;Moradia;Previsto;;;;");
});

test("month totals count only what was confirmed", () => {
  assert.deepEqual(monthTotals(entries), {
    income: 600000, expenses: 228000, balance: 372000,
    categories: [{ name: "Moradia", amount: 188000 }, { name: "Compras", amount: 40000 }],
  });
});

/** Checks the structure every PDF reader relies on: header, objects at the xref offsets, trailer. */
function checkPdf(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.endsWith("%%EOF\n"));
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  assert.ok(text.slice(startxref).startsWith("xref\n"));
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  offsets.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj\n`), `object ${index + 1}`));
  for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = match.index + match[0].length;
    assert.equal(text.slice(start + Number(match[1]), start + Number(match[1]) + 10), "\nendstream");
  }
  return text;
}

test("the month PDF is a valid file with the totals, the entries and accents", () => {
  const text = checkPdf(monthPdf("2026-11", entries, names, "2026-11-21"));
  assert.match(text, /\(Extrato de novembro de 2026\) Tj/);
  // "Saídas" and "Salário" in WinAnsi (í = 0xED, á = 0xE1).
  assert.ok(text.includes("(Saídas) Tj"));
  assert.ok(text.includes("(Salário) Tj"));
  assert.ok(text.includes("(R$ 6.000,00) Tj"));
  assert.ok(text.includes("(Aluguel \"apto; 12\") Tj"));
  // Parentheses inside a PDF string are escaped with a backslash.
  assert.ok(text.includes(String.raw`(Energia \(previsto\)) Tj`));
  assert.match(text, /\/Count 1 >>/);
  assert.match(text, /\(Página 1 de 1\) Tj/);
});

test("long months continue on new pages, with page numbers", () => {
  const many = Array.from({ length: 120 }, (_, index) => ({ ...entries[1], id: String(index), description: `Compra ${index}`, tags: undefined }));
  const text = checkPdf(monthPdf("2026-11", many, names, "2026-11-21"));
  const pages = Number(text.match(/\/Count (\d+) >>/)[1]);
  assert.ok(pages >= 3);
  assert.ok(text.includes(`(Página ${pages} de ${pages}) Tj`));
});

test("text helpers", () => {
  assert.ok(textWidth("R$ 1.000,00", 10) > textWidth("R$ 1,00", 10));
  assert.equal(fit("Curto", 100, 10), "Curto");
  const cut = fit("Uma descrição muito longa que não cabe na coluna", 80, 9);
  assert.ok(cut.endsWith("…") && textWidth(cut, 9) <= 80);
  const pdf = new PdfDocument();
  pdf.text(10, 10, "Emoji 😀 vira ?");
  assert.ok(Buffer.from(pdf.bytes()).toString("latin1").includes("(Emoji ? vira ?) Tj"));
});
