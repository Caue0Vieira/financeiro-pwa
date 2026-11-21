import assert from "node:assert/strict";
import { test } from "node:test";
import { filterText, hasFilters, matchesSearch, normalizeTags, tagTotals } from "./search.ts";

const entry = (fields) => ({
  id: "x", date: "2026-11-10", description: "Hotel Copacabana", amount: -85000, kind: "expense", category: "Lazer",
  status: "confirmed", source: "manual", accountId: "conta", tags: ["viagem rio"], ...fields,
});

test("tags are trimmed, lower case, without #, unique and at most 10", () => {
  assert.deepEqual(normalizeTags("Viagem Rio, #reforma, viagem  rio;  "), ["viagem rio", "reforma"]);
  assert.deepEqual(normalizeTags(["  Casa ", "casa"]), ["casa"]);
  assert.equal(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, 10);
  assert.equal(normalizeTags(["x".repeat(40)])[0].length, 30);
});

test("every filter has to match", () => {
  const hotel = entry({});
  assert.ok(matchesSearch(hotel, { text: "copacabana" }));
  assert.ok(matchesSearch(hotel, { text: "lazer" }));
  assert.ok(matchesSearch(hotel, { text: "VIAGEM" }));
  assert.ok(!matchesSearch(hotel, { text: "mercado" }));
  // Value range is on the amount whatever its sign.
  assert.ok(matchesSearch(hotel, { min: 80000, max: 90000 }));
  assert.ok(!matchesSearch(hotel, { min: 90000 }));
  assert.ok(matchesSearch(entry({ amount: 85000, kind: "income" }), { min: 80000, max: 90000 }));
  assert.ok(matchesSearch(hotel, { from: "2026-11-01", to: "2026-11-10" }));
  assert.ok(!matchesSearch(hotel, { from: "2026-11-11" }));
  assert.ok(matchesSearch(hotel, { source: "account:conta" }));
  assert.ok(!matchesSearch(hotel, { source: "card:nu" }));
  assert.ok(matchesSearch(entry({ accountId: undefined, cardId: "nu" }), { source: "card:nu" }));
  assert.ok(matchesSearch(hotel, { category: "lazer" }));
  assert.ok(!matchesSearch(hotel, { category: "Laz" }));
  assert.ok(matchesSearch(hotel, { tag: "viagem rio" }));
  assert.ok(!matchesSearch(hotel, { tag: "reforma" }));
  assert.ok(!matchesSearch(hotel, { text: "hotel", tag: "reforma" }));
  assert.equal(hasFilters({}), false);
  assert.equal(hasFilters({ text: "  " }), false);
  assert.equal(hasFilters({ tag: "casa" }), true);
});

test("spending per tag counts an entry in each of its tags and ignores income", () => {
  assert.deepEqual(tagTotals([
    entry({ amount: -85000 }),
    entry({ amount: -12000, tags: ["viagem rio", "comida"] }),
    entry({ amount: 2000, kind: "refund", tags: ["comida"] }),
    entry({ amount: 50000, kind: "income", tags: ["viagem rio"] }),
    entry({ amount: -100, tags: [] }),
  ]), [{ name: "viagem rio", amount: 97000 }, { name: "comida", amount: 10000 }]);
});

test("search text is made safe for database filters", () => {
  assert.equal(filterText('a"b\\c*d%e_f'), "a b c d e f");
  assert.equal(filterText("  uber   eats "), "uber eats");
});
