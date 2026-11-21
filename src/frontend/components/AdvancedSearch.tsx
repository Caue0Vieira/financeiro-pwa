import { useEffect, useId, useState } from "react";
import type { Dashboard, EntrySearch } from "../../contracts";
import { cardLabel } from "../format";
import { Field } from "./Field";
import MoneyField from "./MoneyField";
import { Select } from "./Select";

/** Transações → filters beyond the text: value range, period, account or card, category and tag. */
export function AdvancedSearch({
  data,
  filters,
  onChange,
  loadTags,
}: {
  data: Pick<Dashboard, "accounts" | "cards" | "categories">;
  filters: EntrySearch;
  onChange: (filters: EntrySearch) => void;
  loadTags: () => Promise<string[]>;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const categoriesId = useId();
  useEffect(() => {
    let active = true;
    loadTags().then((list) => active && setTags(list)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadTags]);
  const set = (change: Partial<EntrySearch>) => onChange({ ...filters, ...change });
  return (
    <div className="form-grid advanced-search-fields">
      <MoneyField label="Valor de (R$)" name="min" min={0} value={filters.min} onValueChange={(min) => set({ min })} />
      <MoneyField label="Até (R$)" name="max" min={0} value={filters.max} onValueChange={(max) => set({ max })} />
      <Field label="De" type="date" value={filters.from ?? ""} max={filters.to} onChange={(event) => set({ from: event.target.value || undefined })} />
      <Field label="Até" type="date" value={filters.to ?? ""} min={filters.from} onChange={(event) => set({ to: event.target.value || undefined })} />
      <Field label="Conta ou cartão" full>
        <Select value={filters.source ?? ""} onChange={(event) => set({ source: event.target.value || undefined })}>
          <option value="">Todas</option>
          {data.accounts.map((account) => <option key={account.id} value={`account:${account.id}`}>{account.name}</option>)}
          {data.cards.map((card) => <option key={card.id} value={`card:${card.id}`}>{cardLabel(card.name)}{card.archived ? " (excluído)" : ""}</option>)}
        </Select>
      </Field>
      <Field label="Categoria" list={categoriesId} value={filters.category ?? ""} placeholder="Todas" onChange={(event) => set({ category: event.target.value || undefined })} />
      <datalist id={categoriesId}>
        {data.categories.map(({ name }) => <option key={name} value={name} />)}
      </datalist>
      <Field label="Tag">
        <Select value={filters.tag ?? ""} onChange={(event) => set({ tag: event.target.value || undefined })}>
          <option value="">Todas</option>
          {tags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
        </Select>
      </Field>
    </div>
  );
}
