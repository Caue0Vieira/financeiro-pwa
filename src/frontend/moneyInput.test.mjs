import assert from "node:assert/strict";
import { test } from "node:test";
import { centsFromDigits, centsFromPaste } from "./moneyInput.ts";

test("typing and deleting Brazilian currency preserves integer cents", () => {
  assert.equal(centsFromDigits("1"), 1);
  assert.equal(centsFromDigits("R$ 1.234,56"), 123456);
  assert.equal(centsFromDigits("R$ 0,00"), 0);
  assert.equal(centsFromDigits(""), undefined);
  assert.equal(centsFromDigits("99999999999999999"), undefined);
});

test("pasting accepts Brazilian currency and explicit decimal amounts", () => {
  assert.equal(centsFromPaste("R$ 1.234,56"), 123456);
  assert.equal(centsFromPaste("1234.56"), 123456);
  assert.equal(centsFromPaste("1234"), 123400);
  assert.equal(centsFromPaste("-3,50"), undefined);
  assert.equal(centsFromPaste("abc"), undefined);
});
