const saoPaulo = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const todayInSaoPaulo = () => saoPaulo.format(new Date());
export const currentMonth = () => todayInSaoPaulo().slice(0, 7);

export function addDays(date: string, days: number) {
  const day = new Date(date + 'T00:00:00Z');
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, difference: number) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + difference, 1)).toISOString().slice(0, 7);
}

export function dateInMonth(month: string, day: number) {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Default dates of the invoice that is due in `month`. The invoice closes in the same
 * month when the closing day comes before the due day (closes 3, due 10); otherwise it
 * closed the month before (closes 28, due 5). Per-month overrides win over both days.
 */
export function invoiceDates(
  month: string,
  closingDay: number | null,
  dueDay: number | null,
  override?: { closingDate?: string | null; dueDate?: string | null },
) {
  const dueDate = override?.dueDate ?? (dueDay === null ? null : dateInMonth(month, dueDay));
  const closingMonth = closingDay !== null && dueDay !== null && closingDay >= dueDay ? shiftMonth(month, -1) : month;
  const closingDate = override?.closingDate ?? (closingDay === null ? null : dateInMonth(closingMonth, closingDay));
  return { closingDate, dueDate, adjusted: Boolean(override?.closingDate || override?.dueDate) };
}

/**
 * Month (YYYY-MM) of the invoice a card charge on `date` falls into, i.e. the month it is due:
 * charges up to the closing day join the invoice that closes then, later ones the next.
 * Matches invoiceDates(); null when the card lacks either day.
 */
export function invoiceMonthOf(date: string, closingDay: number | null, dueDay: number | null) {
  if (closingDay === null || dueDay === null) return null;
  const shift = (closingDay < dueDay ? 0 : 1) + (Number(date.slice(8, 10)) > closingDay ? 1 : 0);
  return shiftMonth(date.slice(0, 7), shift);
}
