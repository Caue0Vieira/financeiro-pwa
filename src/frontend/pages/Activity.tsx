import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dashboard, Entry, EntrySearch, FinanceService } from "../../contracts";
import { AdvancedSearch } from "../components/AdvancedSearch";
import { hasFilters } from "../../search";
import { money } from "../format";
import { EntryRow, HeaderMenu, Icon, PageHeading } from "../components/common";
import { ListSkeleton } from "../components/Skeleton";
import { todayInSaoPaulo } from "../../date";
import type { OpenEditor } from "../types";

const batchSize = 100;
const kindFilters = [
  ["all", "Todas"],
  ["income", "Receitas"],
  ["expense", "Despesas"],
] as const;
export type ActivityFilter = (typeof kindFilters)[number][0];
const searchKey = (value: string) =>
  value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

function dateHeading(date: string, today: string) {
  const previous = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  if (date === today) return "Hoje";
  if (date === previous) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}

export default function Activity({
  month,
  revision,
  history,
  monthControl,
  openEditor,
  initialFilter,
  onImport,
  search,
  loadTags,
}: {
  month: string;
  revision: Dashboard;
  history: FinanceService["history"];
  search: FinanceService["search"];
  loadTags: FinanceService["tags"];
  monthControl: ReactNode;
  openEditor: OpenEditor;
  initialFilter: ActivityFilter;
  onImport: () => void;
}) {
  const [result, setResult] = useState<{ month: string; rows: Entry[]; hasMore: boolean }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  /** Advanced filters and the result of searching every month with them. */
  const [filters, setFilters] = useState<EntrySearch>({});
  const [found, setFound] = useState<{ rows: Entry[]; limited: boolean }>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchLimit = 200;

  async function runSearch() {
    const all = { ...filters, text: query.trim() || undefined };
    if (!hasFilters(all)) {
      setFound(undefined);
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const rows = await search(all, searchLimit);
      setFound({ rows, limited: rows.length === searchLimit });
    } catch {
      setSearchError(navigator.onLine ? "Não foi possível buscar. Tente de novo." : "Sem conexão. A busca em todos os meses volta quando a internet voltar.");
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setFilters({});
    setQuery("");
    setFound(undefined);
    setSearchError("");
  }
  const version = useRef(0);
  const current = result?.month === month ? result : undefined;
  const rows = current?.rows ?? [];
  const loadingMonth = loading || (!current && !error);

  useEffect(() => {
    const request = ++version.current;
    setLoading(true);
    setError("");
    void history(month, 0, batchSize)
      .then((entries) => {
        if (request !== version.current) return;
        setResult({ month, rows: entries, hasMore: entries.length === batchSize });
      })
      .catch(() => {
        if (request === version.current) setError("Não foi possível carregar as transações.");
      })
      .finally(() => {
        if (request === version.current) setLoading(false);
      });
    return () => {
      version.current++;
    };
  }, [month, revision, history, retry]);

  async function loadMore() {
    const request = ++version.current;
    setLoading(true);
    setError("");
    try {
      const entries = await history(month, rows.length, batchSize);
      if (request !== version.current) return;
      setResult({ month, rows: [...rows, ...entries], hasMore: entries.length === batchSize });
    } catch {
      if (request === version.current) setError("Não foi possível carregar mais transações.");
    } finally {
      if (request === version.current) setLoading(false);
    }
  }

  // A search across months replaces the month's list; otherwise the text filters what is loaded.
  const visible = found
    ? found.rows.filter((item) => filter === "all" || item.kind === filter)
    : rows.filter(
      (item) =>
        (filter === "all" || item.kind === filter) &&
        searchKey(`${item.description} ${item.category} ${(item.tags ?? []).join(" ")}`).includes(searchKey(query.trim())),
    );
  const foundTotal = visible.reduce((sum, item) => sum + item.amount, 0);
  const groups = new Map<string, Entry[]>();
  const today = todayInSaoPaulo();
  for (const entry of visible) {
    const day = groups.get(entry.date);
    if (day) day.push(entry);
    else groups.set(entry.date, [entry]);
  }

  return (
    <>
      <PageHeading
        title="Transações"
        action={
          <div className="reference-header-actions">
            <button
              className="icon-button"
              aria-label={searchOpen ? "Fechar busca" : "Buscar transações"}
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) clearSearch();
                setSearchOpen(!searchOpen);
              }}
            >
              <Icon name={searchOpen ? "close" : "search"} size={20} />
            </button>
            <HeaderMenu icon="moreVertical" label="Opções de transações">
              {monthControl}
              <button className="text-button" onClick={() => openEditor({ type: "entry" })}>
                Novo lançamento
              </button>
              <button className="text-button" onClick={onImport}>
                Importar arquivo
              </button>
            </HeaderMenu>
          </div>
        }
      />
      <section
        className="panel activity-panel screen-list"
        aria-label="Histórico de transações"
        aria-busy={loadingMonth}
      >
        <div className="activity-controls">
          <div className="segmented" role="group" aria-label="Tipo de transação">
            {kindFilters.map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          {searchOpen && (
            <form
              className="advanced-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch();
              }}
            >
              <label className="search-control">
                <Icon name="search" size={17} />
                <input
                  type="search"
                  autoFocus
                  aria-label="Buscar transações"
                  placeholder="Buscar por descrição, categoria ou tag"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <details>
                <summary>Filtros: valor, período, conta, categoria e tag</summary>
                <AdvancedSearch data={revision} filters={filters} onChange={setFilters} loadTags={loadTags} />
              </details>
              <div className="advanced-search-actions">
                <button className="button" disabled={searching}>{searching ? "Buscando…" : "Buscar em todos os meses"}</button>
                {(found || hasFilters({ ...filters, text: query })) && (
                  <button type="button" className="text-button" onClick={clearSearch}>Limpar</button>
                )}
              </div>
              {searchError && <p className="inline-error" role="alert">{searchError}</p>}
              {found && (
                <p className="search-summary" role="status">
                  {visible.length} {visible.length === 1 ? "resultado" : "resultados"} em todos os meses · total {money(foundTotal)}
                  {found.limited && ` (mostrando os ${searchLimit} mais recentes)`}
                </p>
              )}
            </form>
          )}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {found || rows.length > 0 || (!loadingMonth && !error) ? (
          visible.length ? (
            [...groups]
              .sort(([a], [b]) => Number(a > today) - Number(b > today) || b.localeCompare(a))
              .map(([date, entries]) => (
                <section className="activity-group" key={date}>
                  <h2>{dateHeading(date, today)}</h2>
                  {entries.map((item) => (
                    <EntryRow
                      key={item.id}
                      entry={item}
                      grouped
                      compact
                      onEdit={(entry) => openEditor({ type: "entry", item: entry })}
                    />
                  ))}
                </section>
              ))
          ) : (
            <p className="empty">
              {found || query || filter !== "all"
                ? "Nenhuma transação encontrada com esses filtros."
                : "Nenhum lançamento neste mês."}
            </p>
          )
        ) : null}
        {!found && loadingMonth && rows.length === 0 && (
          <>
            <ListSkeleton rows={7} />
            <span className="skeleton-status" role="status">Carregando transações…</span>
          </>
        )}
        {error && rows.length === 0 && !loadingMonth && (
          <button className="text-button load-more" onClick={() => setRetry(retry + 1)}>
            Tentar novamente
          </button>
        )}
        {!found && current?.hasMore && (
          <button className="text-button load-more" disabled={loadingMonth} onClick={() => void loadMore()}>
            Carregar mais
          </button>
        )}
      </section>
    </>
  );
}
