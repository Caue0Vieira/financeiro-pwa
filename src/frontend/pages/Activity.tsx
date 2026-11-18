import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dashboard, Entry, FinanceService } from "../../contracts";
import { EntryRow, HeaderMenu, Icon, PageHeading } from "../components/common";
import { todayInSaoPaulo } from "../../date";
import type { OpenEditor } from "../types";

const batchSize = 100;
const filters = [
  ["all", "Todas"],
  ["income", "Receitas"],
  ["expense", "Despesas"],
] as const;
export type ActivityFilter = (typeof filters)[number][0];
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
  data,
  history,
  monthControl,
  openEditor,
  initialFilter,
  onImport,
}: {
  data: Dashboard;
  history: FinanceService["history"];
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
  const version = useRef(0);
  const current = result?.month === data.month ? result : undefined;
  const rows = current?.rows ?? [];
  const loadingMonth = loading || (!current && !error);

  useEffect(() => {
    const request = ++version.current;
    setLoading(true);
    setError("");
    void history(data.month, 0, batchSize)
      .then((entries) => {
        if (request !== version.current) return;
        setResult({ month: data.month, rows: entries, hasMore: entries.length === batchSize });
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
  }, [data, history, retry]);

  async function loadMore() {
    const request = ++version.current;
    setLoading(true);
    setError("");
    try {
      const entries = await history(data.month, rows.length, batchSize);
      if (request !== version.current) return;
      setResult({ month: data.month, rows: [...rows, ...entries], hasMore: entries.length === batchSize });
    } catch {
      if (request === version.current) setError("Não foi possível carregar mais transações.");
    } finally {
      if (request === version.current) setLoading(false);
    }
  }

  const visible = rows.filter(
    (item) =>
      (filter === "all" || item.kind === filter) &&
      searchKey(`${item.description} ${item.category}`).includes(searchKey(query.trim())),
  );
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
                if (searchOpen) setQuery("");
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
            {filters.map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          {searchOpen && (
            <label className="search-control">
              <Icon name="search" size={17} />
              <input
                type="search"
                autoFocus
                aria-label="Buscar transações"
                placeholder="Buscar transações"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {rows.length > 0 || (!loadingMonth && !error) ? (
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
              {query || filter !== "all"
                ? "Nenhuma transação encontrada com esses filtros."
                : "Nenhum lançamento neste mês."}
            </p>
          )
        ) : null}
        {loadingMonth && (
          <p className="empty" role="status">
            Carregando transações…
          </p>
        )}
        {error && rows.length === 0 && !loadingMonth && (
          <button className="text-button load-more" onClick={() => setRetry(retry + 1)}>
            Tentar novamente
          </button>
        )}
        {current?.hasMore && (
          <button className="text-button load-more" disabled={loadingMonth} onClick={() => void loadMore()}>
            Carregar mais
          </button>
        )}
      </section>
    </>
  );
}
