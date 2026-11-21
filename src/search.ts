import type { Entry, EntrySearch } from './contracts.ts';

/**
 * Tags and advanced search. The demo filters in memory with matchesSearch; the Supabase adapter
 * sends the same filters to the database. Tags are stored lower case, up to 10 per entry.
 */

export const maxTags = 10;
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** "Viagem Rio, #reforma, viagem rio" → ["viagem rio", "reforma"]. */
export function normalizeTags(input: readonly string[] | string): string[] {
  const parts = typeof input === 'string' ? input.split(/[,;\n]/) : input;
  const tags: string[] = [];
  for (const part of parts) {
    const tag = part.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 30).trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, maxTags);
}

/** Whether any filter is set (otherwise there is nothing to search). */
export const hasFilters = (filters: EntrySearch) =>
  Boolean(filters.text?.trim() || filters.min || filters.max || filters.from || filters.to || filters.source || filters.category?.trim() || filters.tag);

export function matchesSearch(entry: Entry, filters: EntrySearch) {
  const text = fold(filters.text ?? '');
  if (text && !fold(`${entry.description} ${entry.category} ${(entry.tags ?? []).join(' ')}`).includes(text)) return false;
  const value = Math.abs(entry.amount);
  if (filters.min && value < filters.min) return false;
  if (filters.max && value > filters.max) return false;
  if (filters.from && entry.date < filters.from) return false;
  if (filters.to && entry.date > filters.to) return false;
  if (filters.source) {
    const source = entry.cardId ? `card:${entry.cardId}` : entry.accountId ? `account:${entry.accountId}` : '';
    if (source !== filters.source) return false;
  }
  if (filters.category?.trim() && fold(entry.category) !== fold(filters.category)) return false;
  if (filters.tag && !(entry.tags ?? []).includes(filters.tag)) return false;
  return true;
}

/** Spending per tag (expenses and refunds, positive cents), largest first. */
export function tagTotals(entries: readonly Pick<Entry, 'kind' | 'amount' | 'tags'>[]) {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== 'expense' && entry.kind !== 'refund') continue;
    for (const tag of new Set(entry.tags ?? [])) totals.set(tag, (totals.get(tag) ?? 0) - entry.amount);
  }
  return [...totals].map(([name, amount]) => ({ name, amount })).filter(({ amount }) => amount !== 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Text safe inside a PostgREST quoted filter value ("…"): no quotes, backslashes or wildcards. */
export const filterText = (text: string) => text.replace(/["\\*%_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
