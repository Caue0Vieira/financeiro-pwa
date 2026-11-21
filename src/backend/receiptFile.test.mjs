import assert from "node:assert/strict";
import { test } from "node:test";
import { fitSize, prepareReceipt, receiptName } from "./receiptFile.ts";

test("photos shrink to the longest side, never grow", () => {
  assert.deepEqual(fitSize(4032, 3024, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(1080, 2400, 1600), { width: 720, height: 1600 });
  assert.deepEqual(fitSize(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(4032, 3024, 320), { width: 320, height: 240 });
});

test("file names are kept readable and get the stored extension", () => {
  assert.equal(receiptName("Nota fiscal mercado.HEIC", "image/jpeg"), "Nota fiscal mercado.jpg");
  assert.equal(receiptName("recibo<script>.pdf", "application/pdf"), "reciboscript.pdf");
  assert.equal(receiptName(".png", "image/jpeg"), "comprovante.jpg");
});

test("PDFs go as they are, up to 5 MB; other files are refused", async () => {
  const pdf = new File(["%PDF-1.4"], "recibo.pdf", { type: "application/pdf" });
  const prepared = await prepareReceipt(pdf);
  assert.deepEqual([prepared.main, prepared.thumb, prepared.contentType, prepared.name], [pdf, undefined, "application/pdf", "recibo.pdf"]);
  await assert.rejects(() => prepareReceipt(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.pdf", { type: "application/pdf" })), /até 5 MB/);
  await assert.rejects(() => prepareReceipt(new File(["x"], "planilha.xlsx", { type: "application/vnd.ms-excel" })), /foto ou um PDF/);
});
