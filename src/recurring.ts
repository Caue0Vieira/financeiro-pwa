import { dateInMonth, invoiceMonthOf, shiftMonth } from './date.ts';

/** A recurring rule as both backends see it (months as YYYY-MM). */
export interface ChargeRule { startMonth: string; endMonth?: string; day: number }
export interface CardDays { closingDay: number | null; dueDay: number | null }

const runsIn = (rule: ChargeRule, month: string) =>
  rule.startMonth.slice(0, 7) <= month && (!rule.endMonth || rule.endMonth.slice(0, 7) >= month);

/** Date of the rule's charge in `month`, or null when the rule is not running then. */
export const chargeDate = (rule: ChargeRule, month: string) =>
  runsIn(rule, month) ? dateInMonth(month, rule.day) : null;

/** Invoice a card charge is billed in: by the card's days, or the charge's own month without them. */
export const chargeInvoiceMonth = (date: string, card?: CardDays) =>
  (card && invoiceMonthOf(date, card.closingDay, card.dueDay)) ?? date.slice(0, 7);

/**
 * Charges of a card rule billed in the invoice due in `month`. A charge after the closing day
 * moves to a later invoice, so it can come from up to two months before.
 */
export function chargesInInvoice(rule: ChargeRule, card: CardDays | undefined, month: string) {
  const dates: string[] = [];
  for (let back = 2; back >= 0; back--) {
    const date = chargeDate(rule, shiftMonth(month, -back));
    if (date && chargeInvoiceMonth(date, card) === month) dates.push(date);
  }
  return dates;
}

/**
 * Date to record a rule marked "lançar sozinho" in `month`: only in the current month, once its day
 * has come, and not for card charges (those already join the invoice). Null when nothing is due.
 */
export function autoRecordDate(rule: ChargeRule & { autoRecord?: boolean; cardId?: string }, month: string, today: string) {
  if (!rule.autoRecord || rule.cardId || month !== today.slice(0, 7)) return null;
  const date = chargeDate(rule, month);
  return date && date <= today ? date : null;
}
