const saoPaulo = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const todayInSaoPaulo = () => saoPaulo.format(new Date());
export const currentMonth = () => todayInSaoPaulo().slice(0, 7);

export function shiftMonth(month: string, difference: number) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + difference, 1)).toISOString().slice(0, 7);
}

export function dateInMonth(month: string, day: number) {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
