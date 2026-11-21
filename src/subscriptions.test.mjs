import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSubscriptions, merchantKey, subscriptionTotals } from "./subscriptions.ts";
import { subscriptionItems } from "./notices.ts";

const today = "2026-11-21";
const monthly = (description, amounts, day = 5) =>
  ({ description, charges: amounts.map((amount, index) => [`2026-${String(11 - amounts.length + 1 + index).padStart(2, "0")}-${String(day).padStart(2, "0")}`, amount]) });

test("merchant key ignores card descriptors and codes", () => {
  assert.equal(merchantKey("PG *SPOTIFY 1234"), "spotify");
  assert.equal(merchantKey("Spotify"), "spotify");
  assert.equal(merchantKey("NETFLIX.COM"), "netflix");
  assert.equal(merchantKey("PAYPAL *HBO MAX BR"), "hbo max");
  assert.equal(merchantKey("PIX"), "");
});

test("monthly and yearly charges with similar amounts; price increase and new ones", () => {
  const list = detectSubscriptions([
    monthly("NETFLIX.COM", [1490, 1490, 1490, 1599]),
    monthly("Netflix", [], 3),
    monthly("PG *SMART FIT", [11990, 11990, 11990], 15),
    { description: "Google Gemini", charges: [["2026-10-04", 9699], ["2026-11-04", 9699]] },
    { description: "Registro de domínio", charges: [["2025-11-02", 6990], ["2026-11-02", 6990]] },
    // Spaced but very different amounts: not a subscription.
    { description: "Posto Shell", charges: [["2026-09-01", 18000], ["2026-10-01", 9000], ["2026-11-01", 25000]] },
    // Stopped months ago.
    { description: "Disney Plus", charges: [["2026-05-10", 3390], ["2026-06-10", 3390]] },
  ], new Map(), today);
  const byName = Object.fromEntries(list.map((item) => [item.key, item]));
  assert.deepEqual(Object.keys(byName).sort(), ["google gemini", "netflix", "registro de", "smart fit"]);
  const netflix = byName.netflix;
  assert.equal(netflix.cadence, "monthly");
  assert.equal(netflix.priceChange, 109);
  assert.equal(netflix.previousAmount, 1490);
  assert.equal(netflix.yearlyCost, 1599 * 12);
  assert.equal(netflix.nextDate, "2026-12-05");
  assert.equal(netflix.isNew, false);
  assert.equal(byName["google gemini"].isNew, true);
  const domain = byName["registro de"];
  assert.deepEqual([domain.cadence, domain.monthlyCost, domain.yearlyCost, domain.nextDate], ["yearly", 583, 6990, "2027-11-02"]);
  assert.equal(subscriptionTotals(list).monthly, 1599 + 11990 + 9699 + 583);
});

test("frequent purchases at the same place are not a subscription", () => {
  const charges = [];
  for (let month = 6; month <= 11; month++) {
    for (const day of [2, 9, 16, 23]) charges.push([`2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, 4000 + day * 10]);
  }
  assert.deepEqual(detectSubscriptions([{ description: "IFOOD *RESTAURANTE", charges }], new Map(), today), []);
});

test("decisions are remembered: ignored stays aside, confirmed stays listed", () => {
  const groups = [monthly("PG *SMART FIT", [11990, 11990, 11990], 15), { description: "Academia do bairro", charges: [["2026-11-10", 8000]] }];
  const list = detectSubscriptions(groups, new Map([["smart fit", "ignored"], ["academia do", "confirmed"]]), today);
  assert.deepEqual(list.map(({ key, status }) => [key, status]), [["academia do", "confirmed"], ["smart fit", "ignored"]]);
  assert.equal(subscriptionTotals(list).monthly, 8000);
});

test("push items: new ones and recent price increases, never ignored", () => {
  const list = detectSubscriptions([
    monthly("NETFLIX.COM", [1490, 1490, 1599], 18),
    { description: "Google Gemini", charges: [["2026-10-04", 9699], ["2026-11-04", 9699]] },
  ], new Map(), today);
  assert.deepEqual(subscriptionItems(list, today).map(({ ref }) => ref).sort(), ["nova:google gemini", "preco:netflix:2026-11-18"]);
  const ignored = detectSubscriptions([{ description: "Google Gemini", charges: [["2026-10-04", 9699], ["2026-11-04", 9699]] }], new Map([["google gemini", "ignored"]]), today);
  assert.deepEqual(subscriptionItems(ignored, today), []);
});
