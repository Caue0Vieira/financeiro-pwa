import type { DetectedSubscription, SubscriptionStatus } from './contracts.ts';
import { addDays, dateInMonth, shiftMonth } from './date.ts';
import { descriptionKey } from './worker/categorize.ts';

/**
 * Subscription detector: charges at the same merchant (normalised description), with a similar
 * amount (±15% from one charge to the next) every month or every year. Shared by the app, the
 * demo and the Worker (push for new subscriptions and price increases).
 */

/** Charges grouped as subscription_charges returns them: [date, cents (positive)]. */
export interface ChargeGroup { description: string; charges: [string, number][] }

/** Words of card descriptors and payment intermediaries that don't name the merchant. */
const noise = new Set([
  'pg', 'pag', 'pagto', 'pagamento', 'compra', 'compras', 'ec', 'mp', 'pp', 'paypal', 'ebanx', 'dm', 'iz', 'pix',
  'debito', 'credito', 'www', 'com', 'br', 'net', 'ltda', 'sa', 'me', 'eireli', 'int', 'internacional', 'parc',
  'assinatura', 'mensalidade', 'plano', 'pagseguro', 'stripe', 'cielo', 'getnet', 'sumup',
]);

/** "PG *SPOTIFY 1234" and "Spotify" → "spotify"; "NETFLIX.COM" → "netflix". Empty when nothing is left. */
export function merchantKey(description: string) {
  return descriptionKey(description).split(' ').filter((word) => word.length > 1 && !noise.has(word)).slice(0, 2).join(' ');
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const similar = (a: number, b: number) => Math.abs(a - b) <= 0.15 * Math.max(a, b);
/** Smaller changes (exchange rate on foreign charges, taxes) are not a price change. */
const priceChangeShare = 0.03;
export const lookbackDays = 400;

type Charge = { date: string; amount: number };

function cadenceOf(series: Charge[]): DetectedSubscription['cadence'] | null {
  const gaps = series.slice(1).map((charge, index) => days(series[index].date, charge.date));
  if (!gaps.length) return null;
  if (gaps.every((gap) => gap >= 24 && gap <= 38)) return 'monthly';
  if (gaps.every((gap) => gap >= 345 && gap <= 385)) return 'yearly';
  return null;
}

/** Charges of the recurring series, oldest first: walks back from the latest, one per period. */
function seriesOf(charges: Charge[]) {
  const series = [charges[charges.length - 1]];
  for (let index = charges.length - 2; index >= 0; index--) {
    const charge = charges[index];
    const next = series[0];
    if (days(charge.date, next.date) >= 20 && similar(charge.amount, next.amount)) series.unshift(charge);
  }
  return series;
}

export function detectSubscriptions(
  groups: ChargeGroup[],
  decisions: Map<string, SubscriptionStatus>,
  today: string,
): DetectedSubscription[] {
  const since = addDays(today, -lookbackDays);
  const merchants = new Map<string, { description: string; charges: Charge[] }>();
  for (const group of groups) {
    const key = merchantKey(group.description);
    if (key.length < 2) continue;
    const merchant = merchants.get(key) ?? { description: group.description, charges: [] };
    for (const [date, amount] of group.charges) {
      const day = String(date).slice(0, 10);
      if (day < since || day > today || !(Number(amount) > 0)) continue;
      merchant.charges.push({ date: day, amount: Number(amount) });
    }
    merchants.set(key, merchant);
  }

  const found: DetectedSubscription[] = [];
  for (const [key, { description, charges }] of merchants) {
    if (!charges.length) continue;
    charges.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
    const decision = decisions.get(key);
    const series = seriesOf(charges);
    const last = series[series.length - 1];
    let cadence = cadenceOf(series);
    // A store bought from often (delivery, market) is not a subscription even if some charges line up.
    const others = charges.filter((charge) => charge.date >= series[0].date && !series.includes(charge)).length;
    if (others > series.length / 2) cadence = null;
    const recent = cadence === 'yearly' ? last.date >= addDays(today, -385) : last.date >= addDays(today, -45);
    if (!recent) cadence = null;
    // Once confirmed, it stays listed while it is still charged, even if the pattern got looser.
    if (!cadence && decision === 'confirmed' && last.date >= addDays(today, -45)) cadence = 'monthly';
    if (!cadence) continue;

    const previous = series.length > 1 ? series[series.length - 2] : undefined;
    const change = previous ? last.amount - previous.amount : 0;
    const months = cadence === 'monthly' ? 1 : 12;
    found.push({
      key,
      name: displayName(description),
      cadence,
      amount: last.amount,
      previousAmount: previous?.amount,
      priceChange: previous && Math.abs(change) >= previous.amount * priceChangeShare ? change : 0,
      monthlyCost: cadence === 'monthly' ? last.amount : Math.round(last.amount / 12),
      yearlyCost: cadence === 'monthly' ? last.amount * 12 : last.amount,
      lastDate: last.date,
      nextDate: dateInMonth(shiftMonth(last.date.slice(0, 7), months), Number(last.date.slice(8, 10))),
      charges: series.length,
      // New: it started charging in the last two months and the user hasn't decided yet.
      isNew: !decision && charges[0].date >= addDays(today, -62),
      status: decision ?? 'suggested',
    });
  }
  const order: Record<SubscriptionStatus | 'suggested', number> = { suggested: 0, confirmed: 1, ignored: 2 };
  return found.sort((a, b) => order[a.status] - order[b.status] || b.yearlyCost - a.yearlyCost || a.name.localeCompare(b.name, 'pt-BR'));
}

/** "NETFLIX.COM" → "Netflix.com"; mixed-case names stay as they are. */
function displayName(description: string) {
  const text = description.replace(/\s+/g, ' ').replace(/^(pg|pag|pagto|ec|mp|pp|dm|iz)\s*\*\s*/i, '').trim().slice(0, 60);
  return text === text.toUpperCase() ? text.charAt(0) + text.slice(1).toLowerCase() : text;
}

/** Totals of what counts (everything not ignored). */
export function subscriptionTotals(list: DetectedSubscription[]) {
  const active = list.filter(({ status }) => status !== 'ignored');
  return {
    monthly: active.reduce((sum, item) => sum + item.monthlyCost, 0),
    yearly: active.reduce((sum, item) => sum + item.yearlyCost, 0),
  };
}
