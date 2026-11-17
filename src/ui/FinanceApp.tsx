import React, { useEffect, useRef, useState } from "react";
import type {
  Action,
  Dashboard,
  Entry,
  EntryKind,
  FinanceService,
  Investment,
  Recurrence,
} from "../contracts";
import "./app.css";
import { ApiTiming } from "./ApiTiming";
import { todayInSaoPaulo } from "../date";

type Props = {
  data: Dashboard;
  month: string;
  onMonth: (month: string) => void;
  service: FinanceService;
  refresh: () => Promise<void>;
  importView: React.ReactNode;
  preview: boolean;
  email: string;
  onSignOut: () => Promise<void>;
};
type Modal = { type: string; item?: any } | null;
const paths: Record<string, React.ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 21v-7h6v7" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="3" />
      <path d="M3 9h18M16 14h2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrowUp: <path d="M12 19V5m-5 5 5-5 5 5" />,
  arrowDown: <path d="M12 5v14m-5-5 5 5 5-5" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  upload: (
    <>
      <path d="M12 16V4m-4 4 4-4 4 4" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H5v16h5m4-4 4-4-4-4m4 4H9" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </>
  ),
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.wallet}
    </svg>
  );
}
const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    (n || 0) / 100,
  );
const monthName = (s: string) =>
  new Date(
    Number(s.slice(0, 4)),
    Number(s.slice(5, 7)) - 1,
    1,
  ).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const shiftMonth = (s: string, delta: number) => {
  const d = new Date(
    Number(s.slice(0, 4)),
    Number(s.slice(5, 7)) - 1 + delta,
    1,
  );
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const dateLabel = (s: string) =>
  s
    ? new Date(s + "T12:00:00")
        .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
        .replace(".", "")
    : "";
const kindLabel: Record<EntryKind, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  card_payment: "Pagamento de cartão",
  investment: "Investimento",
  saving: "Reserva",
  refund: "Estorno",
  uncategorized: "Não classificado",
};
function Field({ label, name, children, full = false, ...props }: any) {
  return (
    <label className={"field" + (full ? " full" : "")}>
      {label}
      {children || <input name={name} {...props} />}
    </label>
  );
}
function Overlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const controls = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0);
          if (!controls.length) {
            e.preventDefault();
            return;
          }
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === ref.current)
          ) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function EntryRow({ entry, onClick }: { entry: Entry; onClick: () => void }) {
  return (
    <div className="transaction">
      <div className="transaction-icon">
        <Icon
          name={entry.kind === "income" ? "arrowDown" : "arrowUp"}
          size={17}
        />
      </div>
      <div className="transaction-info">
        <strong>{entry.description}</strong>
        <span>
          {entry.kind === "card_payment" &&
          Math.abs(entry.amount) > (entry.allocatedAmount || 0)
            ? "Fatura a conciliar"
            : entry.category || kindLabel[entry.kind]}{" "}
          · {dateLabel(entry.date)}
          {entry.status === "planned" ? " · Previsto" : ""}
          {entry.installmentCount
            ? ` · ${entry.installmentNumber}/${entry.installmentCount}`
            : ""}
        </span>
      </div>
      <span
        className={"transaction-amount " + (entry.amount > 0 ? "income" : "")}
      >
        {entry.amount > 0 ? "+ " : entry.amount < 0 ? "− " : ""}
        {money(Math.abs(entry.amount))}
      </span>
      <button
        className="icon-button row-edit"
        onClick={onClick}
        aria-label={`Editar ${entry.description}`}
      >
        <Icon name="more" size={16} />
      </button>
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  icon,
  primary = false,
}: {
  label: string;
  value: number;
  note: string;
  icon: string;
  primary?: boolean;
}) {
  return (
    <div className={"metric" + (primary ? " primary" : "")}>
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="metric-value">{money(value)}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}
function Chart({ trend }: { trend: Dashboard["trend"] }) {
  const max = Math.max(1, ...trend.flatMap((t) => [t.income, t.expenses]));
  return (
    <>
      <div
        className="chart"
        role="img"
        aria-label={
          "Receitas e despesas por mês: " +
          trend
            .map(
              (t) =>
                `${monthName(t.month)}, ${money(t.income)} em receitas e ${money(t.expenses)} em despesas`,
            )
            .join("; ")
        }
      >
        <span className="chart-y" style={{ top: 10 }}>
          máx.
        </span>
        <span className="chart-y" style={{ bottom: 22 }}>
          0
        </span>
        {trend.map((t) => (
          <div className="chart-bar-wrap" key={t.month}>
            <div
              className="chart-bar"
              style={{ height: `${Math.max(1, (t.income / max) * 100)}%` }}
            />
            <div
              className="chart-bar expense"
              style={{ height: `${Math.max(1, (t.expenses / max) * 100)}%` }}
            />
            <span className="chart-label">
              {monthName(t.month).slice(0, 3)}
            </span>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 18 }}>
        <span>Receitas</span>
        <span>Despesas</span>
      </div>
    </>
  );
}
const nav = [
  ["home", "Visão geral"],
  ["activity", "Transações"],
  ["wallet", "Contas"],
  ["chart", "Investimentos"],
  ["user", "Perfil"],
];
export default function FinanceApp({
  data,
  month,
  onMonth,
  service,
  refresh,
  importView,
  preview,
  email,
  onSignOut,
}: Props) {
  const [page, setPage] = useState("home"),
    [modal, setModal] = useState<Modal>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Entry[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(true),
    [theme, setTheme] = useState(
      () => localStorage.getItem("finance-theme") || "system",
    );
  useEffect(() => {
    localStorage.setItem("finance-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (page === "activity" || page === "wallet") {
      service
        .history(month, 0, 100)
        .then((rows) => {
          setHistory(rows);
          setOffset(rows.length);
          setMore(rows.length === 100);
        })
        .catch((e) => setMessage(e.message));
    }
  }, [page, month, service, data]);
  const mutate = async (action: Action) => {
    setBusy(true);
    setMessage("");
    try {
      await service.mutate(action);
      await refresh();
      setModal(null);
      setMessage("Alterações salvas.");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };
  const navTo = (id: string) => {
    setPage(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const displayName = data.profile.name || "você";
  const navigation = (mobile = false) => (
    <nav
      className={mobile ? "mobile-nav" : "nav"}
      aria-label="Navegação principal"
    >
      {nav.map(([id, label], i) => (
        <React.Fragment key={id}>
          {mobile && i === 2 && (
            <button
              className="add-button"
              onClick={() => setModal({ type: "entry" })}
              aria-label="Adicionar lançamento"
            >
              <Icon name="plus" size={22} />
            </button>
          )}
          <button
            className={page === id ? "active" : ""}
            onClick={() => navTo(id)}
            aria-current={page === id ? "page" : undefined}
          >
            <Icon name={id} />
            <span>{mobile && id === "home" ? "Início" : label}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
  const renderEntries = (entries: Entry[]) =>
    entries.length ? (
      entries.map((e) => (
        <EntryRow
          key={e.id}
          entry={e}
          onClick={() => setModal({ type: "entry", item: e })}
        />
      ))
    ) : (
      <div className="empty">
        Nenhum lançamento por aqui ainda.
        <br />
        Adicione um lançamento ou importe um arquivo.
      </div>
    );
  const heading = (title: string, desc: string, action?: React.ReactNode) => (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {action}
    </div>
  );
  const monthControl = (
    <div className="month-switch">
      <button
        onClick={() => onMonth(shiftMonth(month, -1))}
        aria-label="Mês anterior"
      >
        <Icon name="chevronLeft" size={15} />
      </button>
      <span>{monthName(month)}</span>
      <button
        onClick={() => onMonth(shiftMonth(month, 1))}
        aria-label="Próximo mês"
      >
        <Icon name="chevronRight" size={15} />
      </button>
    </div>
  );
  return (
    <div
      className={
        "app-shell " +
        (theme === "dark"
          ? "theme-dark"
          : theme === "system"
            ? "theme-system"
            : "")
      }
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="chart" size={18} />
          </span>
          financeiro<span style={{ color: "#8daa91" }}>.</span>
        </div>
        {navigation()}
        <div className="sidebar-bottom">
          <button onClick={() => navTo("import")}>
            <Icon name="upload" /> Importar arquivo
          </button>
          <div className="sidebar-user">
            <span className="avatar">
              {data.profile.avatarUrl ? (
                <img src={data.profile.avatarUrl} alt="" />
              ) : (
                displayName[0]?.toUpperCase()
              )}
            </span>
            <div>
              <strong>{displayName}</strong>
              <small>{preview ? "Modo demonstração" : "Sua conta"}</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <span className="date">
            Seu espaço financeiro {preview && "· Demonstração"}
          </span>
          <div className="top-actions">
            <button
              className="button desktop-add"
              onClick={() => setModal({ type: "entry" })}
            >
              <Icon name="plus" size={16} /> Adicionar
            </button>
            <button
              className="icon-button"
              onClick={() => navTo("import")}
              aria-label="Importar arquivo"
            >
              <Icon name="upload" size={16} />
            </button>
            <button
              className="avatar profile-action"
              onClick={() => navTo("user")}
              aria-label="Abrir perfil"
            >
              {data.profile.avatarUrl ? (
                <img src={data.profile.avatarUrl} alt="" />
              ) : (
                displayName[0]?.toUpperCase()
              )}
            </button>
          </div>
        </div>
        <div
          role="status"
          aria-live="polite"
          className={message ? "notice" : ""}
        >
          {message}
          {message && (
            <button onClick={() => setMessage("")} aria-label="Dispensar aviso">
              ×
            </button>
          )}
        </div>
        {page === "home" && (
          <>
            {heading(
              "Visão do mês",
              "Seu resumo financeiro em um só lugar.",
              monthControl,
            )}
            <div className="summary">
              <Metric
                label="Recebido"
                value={data.received}
                note={`de ${money(data.expectedIncome)} previstos`}
                icon="arrowDown"
                primary
              />
              <Metric
                label="Despesas"
                value={data.expenses}
                note="Neste mês"
                icon="arrowUp"
              />
              <Metric
                label="A pagar"
                value={data.toPay}
                note="Compromissos previstos"
                icon="calendar"
              />
              <Metric
                label="Saldo previsto"
                value={data.projectedSurplus}
                note="Receitas menos despesas"
                icon="wallet"
              />
            </div>
            <div className="content-grid">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Movimentação</h2>
                    <p>Receitas e despesas ao longo do tempo</p>
                  </div>
                </div>
                <Chart trend={data.trend} />
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Sua meta</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setModal({ type: "goal" })}
                  >
                    Editar meta
                  </button>
                </div>
                <div className="goal-amount">{money(data.saved)}</div>
                <span className="subtle">guardados de {money(data.goal)}</span>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="Progresso da meta"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    data.goal
                      ? Math.min(
                          100,
                          Math.round((data.saved / data.goal) * 100),
                        )
                      : 0
                  }
                >
                  <span
                    style={{
                      width: `${data.goal ? Math.min(100, Math.max(0, (data.saved / data.goal) * 100)) : 0}%`,
                    }}
                  />
                </div>
                <div className="split">
                  <span>
                    {data.goal ? Math.round((data.saved / data.goal) * 100) : 0}
                    % concluído
                  </span>
                  <span>
                    {money(Math.max(0, data.goal - data.saved))} restantes
                  </span>
                </div>
                {!data.goal && (
                  <div className="goal-callout">
                    Defina uma meta para acompanhar o que você guarda.
                  </div>
                )}
              </section>
            </div>
            <div className="overview-details">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Investimentos</h2>
                    <p>Patrimônio por instituição</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navTo("chart")}
                  >
                    Ver investimentos →
                  </button>
                </div>
                <div className="overview-total">{money(data.invested)}</div>
                {Array.from(new Set(data.investments.map((i) => i.institution)))
                  .map((institution) => ({
                    institution,
                    value: data.investments
                      .filter((i) => i.institution === institution)
                      .reduce((sum, i) => sum + i.value, 0),
                  }))
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 3)
                  .map((group) => (
                    <div className="overview-line" key={group.institution}>
                      <span>{group.institution}</span>
                      <strong>{money(group.value)}</strong>
                    </div>
                  ))}
                {!data.investments.length && (
                  <p className="subtle">Nenhum investimento cadastrado.</p>
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Próximos vencimentos</h2>
                    <p>Compromissos previstos para o mês</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navTo("wallet")}
                  >
                    Ver contas →
                  </button>
                </div>
                {data.upcoming.length ? (
                  data.upcoming
                    .slice(0, 3)
                    .map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        onClick={() => setModal({ type: "entry", item: entry })}
                      />
                    ))
                ) : (
                  <p className="subtle">
                    Nenhum compromisso previsto neste mês.
                  </p>
                )}
              </section>
            </div>
            <div className="section-title">
              <h2>Atividade recente</h2>
              <button className="text-button" onClick={() => navTo("activity")}>
                Ver tudo →
              </button>
            </div>
            <div className="panel list-panel">{renderEntries(data.recent)}</div>
          </>
        )}
        {page === "activity" && (
          <>
            {heading(
              "Transações",
              "Tudo o que entra e sai, em um só lugar.",
              <div className="heading-actions">
                {monthControl}
                <button
                  className="button"
                  onClick={() => setModal({ type: "entry" })}
                >
                  <Icon name="plus" size={15} /> Novo lançamento
                </button>
              </div>,
            )}
            <div className="panel list-panel">
              {renderEntries(history)}
              {more && (
                <button
                  className="text-button load-more"
                  onClick={async () => {
                    try {
                      const rows = await service.history(month, offset, 30);
                      setHistory([...history, ...rows]);
                      setOffset(offset + rows.length);
                      setMore(rows.length === 30);
                    } catch (e) {
                      setMessage(
                        e instanceof Error
                          ? e.message
                          : "Erro ao carregar histórico.",
                      );
                    }
                  }}
                >
                  Carregar mais
                </button>
              )}
            </div>
          </>
        )}
        {page === "wallet" && (
          <>
            {heading(
              "Contas e compromissos",
              "Organize o que vem pela frente.",
              <button
                className="button"
                onClick={() => setModal({ type: "recurrence" })}
              >
                <Icon name="plus" size={15} /> Nova recorrência
              </button>,
            )}
            <div className="two-columns">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Próximos lançamentos</h2>
                    <p>Previstos para {monthName(month)}</p>
                  </div>
                  {monthControl}
                </div>
                {renderEntries(data.upcoming)}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Recorrências</h2>
                    <p>Receitas e despesas que se repetem</p>
                  </div>
                </div>
                {data.recurrences.length ? (
                  data.recurrences.map((r) => (
                    <div className="transaction" key={r.id}>
                      <div className="transaction-info">
                        <strong>{r.description}</strong>
                        <span>
                          Dia {r.day} · {r.category}
                        </span>
                      </div>
                      <span className="transaction-amount">
                        {money(r.amount)}
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal({ type: "recurrence", item: r })
                        }
                      >
                        Editar
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty">Nenhuma recorrência cadastrada.</div>
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Faturas</h2>
                    <p>Acompanhe e concilie pagamentos</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setModal({ type: "installments" })}
                  >
                    Adicionar parcelas
                  </button>
                </div>
                {data.invoices.length ? (
                  data.invoices.map((i) => (
                    <div className="transaction" key={i.cardId + i.month}>
                      <div className="transaction-info">
                        <strong>
                          {data.cards.find((c) => c.id === i.cardId)?.name ||
                            "Cartão"}
                        </strong>
                        <span>
                          Vence {dateLabel(i.dueDate)} · Pago {money(i.paid)}
                        </span>
                      </div>
                      <span className="transaction-amount">
                        {money(i.total)}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "settle", item: i })}
                      >
                        Conciliar
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty">Nenhuma fatura neste mês.</div>
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Contas e cartões</h2>
                    <p>Suas fontes de movimentação</p>
                  </div>
                </div>
                {data.accounts.map((a) => (
                  <div className="transaction" key={a.id}>
                    <div className="transaction-info">
                      <strong>{a.name}</strong>
                      <span>Conta</span>
                    </div>
                  </div>
                ))}
                {data.cards.map((c) => (
                  <div className="transaction" key={c.id}>
                    <div className="transaction-info">
                      <strong>{c.name}</strong>
                      <span>Cartão · vence dia {c.dueDay}</span>
                    </div>
                  </div>
                ))}
                <div className="form-actions">
                  <button
                    className="button secondary"
                    onClick={() => setModal({ type: "account" })}
                  >
                    Adicionar conta
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setModal({ type: "card" })}
                  >
                    Adicionar cartão
                  </button>
                </div>
              </section>
            </div>
          </>
        )}
        {page === "chart" && (
          <>
            {heading(
              "Investimentos",
              "Uma visão do seu patrimônio investido.",
              <button
                className="button"
                onClick={() => setModal({ type: "investment" })}
              >
                <Icon name="plus" size={15} /> Adicionar investimento
              </button>,
            )}
            <div className="investment-total">
              <span>Patrimônio investido</span>
              <strong>{money(data.invested)}</strong>
              <small>Valor informado dos seus investimentos</small>
            </div>
            <div className="section-title">
              <h2>Seus investimentos</h2>
            </div>
            <div className="panel list-panel">
              {data.investments.length ? (
                Array.from(
                  new Set(data.investments.map((i) => i.institution)),
                ).map((institution) => (
                  <div key={institution}>
                    <div className="institution-heading">
                      <strong>{institution}</strong>
                      <span>
                        {money(
                          data.investments
                            .filter((i) => i.institution === institution)
                            .reduce((sum, i) => sum + i.value, 0),
                        )}
                      </span>
                    </div>
                    {data.investments
                      .filter((i) => i.institution === institution)
                      .map((i) => (
                        <div className="transaction" key={i.id}>
                          <div className="transaction-icon">
                            <Icon name="chart" />
                          </div>
                          <div className="transaction-info">
                            <strong>{i.name}</strong>
                            <span>Aplicado {money(i.contributed)}</span>
                          </div>
                          <span className="transaction-amount">
                            {money(i.value)}
                          </span>
                          <button
                            className="text-button"
                            onClick={() =>
                              setModal({ type: "investment", item: i })
                            }
                          >
                            Editar
                          </button>
                        </div>
                      ))}
                  </div>
                ))
              ) : (
                <div className="empty">
                  Adicione seu primeiro investimento para acompanhar seu
                  patrimônio.
                </div>
              )}
            </div>
          </>
        )}
        {page === "import" && (
          <>
            {heading(
              "Importar arquivos",
              "Traga seus extratos e faturas para perto.",
            )}
            {importView}
          </>
        )}
        {page === "user" && (
          <>
            {heading("Seu perfil", "Suas preferências e segurança.")}
            <div className="two-columns">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Dados pessoais</h2>
                    <p>Como você aparece no seu espaço</p>
                  </div>
                </div>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    setBusy(true);
                    try {
                      const file = f.get("avatar") as File;
                      await service.saveProfile(
                        String(f.get("name")),
                        file?.size ? file : undefined,
                      );
                      await refresh();
                      setMessage("Perfil atualizado.");
                    } catch (err) {
                      setMessage(
                        err instanceof Error
                          ? err.message
                          : "Não foi possível atualizar o perfil.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="form-grid">
                    <Field
                      label="Nome"
                      name="name"
                      defaultValue={data.profile.name}
                      required
                      full
                    />
                    <Field
                      label="Foto de perfil"
                      name="avatar"
                      type="file"
                      accept="image/*"
                      full
                    />
                  </div>
                  <div className="form-actions">
                    <button className="button" disabled={busy}>
                      Salvar perfil
                    </button>
                    {data.profile.avatarUrl && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await service.saveProfile(data.profile.name, null);
                            await refresh();
                            setMessage("Foto removida.");
                          } catch (e) {
                            setMessage(
                              e instanceof Error
                                ? e.message
                                : "Erro ao remover foto.",
                            );
                          }
                        }}
                      >
                        Remover foto
                      </button>
                    )}
                  </div>
                </form>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Preferências</h2>
                    <p>Escolha como prefere visualizar o aplicativo</p>
                  </div>
                </div>
                <label className="field">
                  Aparência
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="system">Usar configuração do sistema</option>
                    <option value="light">Claro</option>
                    <option value="dark">Escuro</option>
                  </select>
                </label>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Segurança</h2>
                    <p>Atualize sua senha de acesso</p>
                  </div>
                </div>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    setBusy(true);
                    try {
                      await service.changePassword(
                        String(f.get("current")),
                        String(f.get("next")),
                      );
                      form.reset();
                      setMessage("Senha atualizada.");
                    } catch (err) {
                      setMessage(
                        err instanceof Error
                          ? err.message
                          : "Não foi possível atualizar a senha.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="form-grid">
                    <Field
                      label="Senha atual"
                      name="current"
                      type="password"
                      autoComplete="current-password"
                      required
                      full
                    />
                    <Field
                      label="Nova senha"
                      name="next"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      full
                    />
                  </div>
                  <div className="form-actions">
                    <button className="button" disabled={busy}>
                      Alterar senha
                    </button>
                  </div>
                </form>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Sessão</h2>
                    <p>
                      {preview
                        ? "Você está explorando uma demonstração."
                        : email}
                    </p>
                  </div>
                </div>
                <button
                  className="button secondary"
                  onClick={() => void onSignOut()}
                >
                  <Icon name="logout" size={16} />{" "}
                  {preview ? "Sair da demonstração" : "Sair da conta"}
                </button>
              </section>
              {!preview && <ApiTiming service={service} month={month} />}
            </div>
          </>
        )}
      </main>
      {navigation(true)}
      {modal && (
        <Editor
          modal={modal}
          data={data}
          month={month}
          busy={busy}
          service={service}
          close={() => setModal(null)}
          mutate={mutate}
        />
      )}
    </div>
  );
}
function Editor({
  modal,
  data,
  month,
  busy,
  service,
  close,
  mutate,
}: {
  modal: NonNullable<Modal>;
  data: Dashboard;
  month: string;
  busy: boolean;
  service: FinanceService;
  close: () => void;
  mutate: (action: Action) => Promise<void>;
}) {
  const { type, item } = modal;
  const today = todayInSaoPaulo();
  const [kind, setKind] = useState<EntryKind>(item?.kind || "expense");
  const [accountId, setAccountId] = useState<string>(item?.accountId ?? "");
  const [cardId, setCardId] = useState<string>(item?.cardId ?? "");
  const [remove, setRemove] = useState(false);
  const [paymentMonth, setPaymentMonth] = useState<string>(item?.month ?? month);
  const [payments, setPayments] = useState<Entry[]>([]);
  const [paymentId, setPaymentId] = useState("");
  const [settlementAmount, setSettlementAmount] = useState("");
  const [paymentState, setPaymentState] = useState<"loading" | "ready" | "failed">("loading");
  const chooseDirection = kind === "investment" || kind === "transfer" || kind === "uncategorized";
  useEffect(() => {
    if (type !== "settle" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(paymentMonth)) return;
    let active = true;
    async function loadPayments() {
      setPaymentState("loading");
      const candidates: Entry[] = [];
      try {
        const limit = 100;
        for (let offset = 0; active; offset += limit) {
          const page = await service.history(paymentMonth, offset, limit);
          candidates.push(...page.filter((entry) => entry.kind === "card_payment" &&
            entry.status === "confirmed" && -entry.amount > (entry.allocatedAmount ?? 0)));
          if (page.length < limit) break;
        }
        if (active) {
          setPayments(candidates);
          setPaymentState("ready");
        }
      } catch {
        if (active) setPaymentState("failed");
      }
    }
    void loadPayments();
    return () => { active = false; };
  }, [type, paymentMonth, service]);
  const titles: Record<string, string> = {
    entry: item ? "Editar lançamento" : "Novo lançamento",
    goal: "Definir meta",
    investment: item ? "Editar investimento" : "Novo investimento",
    recurrence: item ? "Editar recorrência" : "Nova recorrência",
    account: "Nova conta",
    card: "Novo cartão",
    installments: "Adicionar parcelas",
    settle: "Conciliar fatura",
  };
  const amount = (n: number | undefined) =>
    n == null ? "" : String(Math.abs(n) / 100);
  const read = (f: FormData, k: string) => String(f.get(k) || "").trim();
  const cents = (f: FormData, k: string) =>
    Math.round(Number(read(f, k).replace(",", ".")) * 100);
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (type === "entry") {
      const raw = cents(f, "amount");
      void mutate({
        type: "saveEntry",
        entry: {
          ...(item || {}),
          id: item?.id,
          date: read(f, "date"),
          description: read(f, "description"),
          amount:
            kind === "expense" || kind === "card_payment" || kind === "saving" ||
            (chooseDirection && read(f, "direction") === "out") ? -raw : raw,
          kind,
          category: read(f, "category"),
          status: read(f, "status") as Entry["status"],
          accountId: accountId || undefined,
          cardId: cardId || undefined,
          invoiceMonth: cardId ? read(f, "invoiceMonth") || month : undefined,
        },
      });
    } else if (type === "goal")
      void mutate({ type: "saveGoal", month, amount: cents(f, "amount") });
    else if (type === "investment")
      void mutate({
        type: "saveInvestment",
        investment: {
          id: item?.id,
          name: read(f, "name"),
          institution: read(f, "institution"),
          contributed: cents(f, "contributed"),
          value: cents(f, "value"),
          updatedOn: read(f, "updatedOn"),
        },
      });
    else if (type === "account")
      void mutate({ type: "saveAccount", account: { name: read(f, "name") } });
    else if (type === "card")
      void mutate({
        type: "saveCard",
        card: { name: read(f, "name"), dueDay: Number(read(f, "dueDay")) },
      });
    else if (type === "recurrence") {
      const k = read(f, "kind") as "income" | "expense";
      void mutate({
        type: "saveRecurrence",
        recurrence: {
          id: item?.id,
          description: read(f, "description"),
          amount: (k === "expense" ? -1 : 1) * cents(f, "amount"),
          kind: k,
          category: read(f, "category"),
          startMonth: read(f, "startMonth"),
          day: Number(read(f, "day")),
          endMonth: read(f, "endMonth") || undefined,
        },
        effectiveMonth: read(f, "effectiveMonth") || undefined,
      });
    } else if (type === "installments")
      void mutate({
        type: "addInstallments",
        cardId: read(f, "cardId"),
        description: read(f, "description"),
        category: read(f, "category"),
        total: cents(f, "total"),
        count: Number(read(f, "count")),
        firstMonth: read(f, "firstMonth"),
      });
    else if (type === "settle")
      void mutate({
        type: "settleInvoice",
        paymentId: read(f, "paymentId"),
        cardId: item.cardId,
        month: item.month,
        amount: cents(f, "amount"),
      });
  };
  return (
    <Overlay title={titles[type]} onClose={close}>
      <form onSubmit={submit}>
        <div className="form-grid">
          {type === "entry" && (
            <>
              <Field
                label="Descrição"
                name="description"
                defaultValue={item?.description}
                required
                full
              />
              <Field
                label="Valor (R$)"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={amount(item?.amount)}
                required
              />
              <Field
                label="Data"
                name="date"
                type="date"
                defaultValue={item?.date || today}
                required
              />
              <Field label="Classificação">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as EntryKind)}
                >
                  {Object.entries(kindLabel).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Categoria"
                name="category"
                defaultValue={item?.category || ""}
                placeholder="Ex.: Alimentação"
              />
              {chooseDirection && (
                <Field label="Movimento">
                  <select name="direction" defaultValue={item?.amount > 0 ? "in" : "out"}>
                    <option value="out">Saída</option>
                    <option value="in">Entrada</option>
                  </select>
                </Field>
              )}
              <Field label="Situação">
                <select
                  name="status"
                  defaultValue={item?.status || "confirmed"}
                >
                  <option value="confirmed">Confirmado</option>
                  <option value="planned">Previsto</option>
                </select>
              </Field>
              <Field label="Conta">
                <select value={accountId} onChange={(e) => {
                  setAccountId(e.target.value);
                  if (e.target.value) setCardId("");
                }}>
                  <option value="">Não informada</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cartão">
                <select value={cardId} onChange={(e) => {
                  setCardId(e.target.value);
                  if (e.target.value) setAccountId("");
                }}>
                  <option value="">Não informado</option>
                  {data.cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              {cardId && (
                <Field label="Mês da fatura" name="invoiceMonth" type="month"
                  defaultValue={item?.invoiceMonth || month} required />
              )}
            </>
          )}
          {type === "goal" && (
            <Field
              label="Meta para o mês (R$)"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={amount(data.goal)}
              required
              full
            />
          )}
          {type === "investment" && (
            <>
              <Field
                label="Nome do investimento"
                name="name"
                defaultValue={item?.name}
                required
                full
              />
              <Field
                label="Instituição"
                name="institution"
                defaultValue={item?.institution}
                required
                full
              />
              <Field
                label="Valor aplicado (R$)"
                name="contributed"
                type="number"
                min="0"
                step="0.01"
                defaultValue={amount(item?.contributed)}
                required
              />
              <Field
                label="Valor atual (R$)"
                name="value"
                type="number"
                min="0"
                step="0.01"
                defaultValue={amount(item?.value)}
                required
              />
              <Field
                label="Data da atualização"
                name="updatedOn"
                type="date"
                defaultValue={item?.updatedOn || today}
                required
                full
              />
            </>
          )}
          {(type === "account" || type === "card") && (
            <>
              <Field
                label={type === "account" ? "Nome da conta" : "Nome do cartão"}
                name="name"
                required
                full
              />
              {type === "card" && (
                <Field
                  label="Dia do vencimento"
                  name="dueDay"
                  type="number"
                  min="1"
                  max="31"
                  required
                  full
                />
              )}
            </>
          )}
          {type === "recurrence" && (
            <>
              <Field
                label="Descrição"
                name="description"
                defaultValue={item?.description}
                required
                full
              />
              <Field
                label="Valor (R$)"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={amount(item?.amount)}
                required
              />
              <Field label="Tipo">
                <select name="kind" defaultValue={item?.kind || "expense"}>
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </Field>
              <Field
                label="Categoria"
                name="category"
                defaultValue={item?.category || ""}
              />
              <Field
                label="Dia do mês"
                name="day"
                type="number"
                min="1"
                max="31"
                defaultValue={item?.day || 1}
                required
              />
              <Field
                label="Mês inicial"
                name="startMonth"
                type="month"
                defaultValue={item?.startMonth || month}
                required
              />
              <Field
                label="Mês final (opcional)"
                name="endMonth"
                type="month"
                defaultValue={item?.endMonth || ""}
              />
              {item && (
                <Field
                  label="Aplicar alteração a partir de"
                  name="effectiveMonth"
                  type="month"
                  defaultValue={month}
                  full
                />
              )}
            </>
          )}
          {type === "installments" && (
            <>
              <Field label="Descrição" name="description" required full />
              <Field label="Cartão" full>
                <select name="cardId" required>
                  <option value="">Selecione</option>
                  {data.cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Categoria" name="category" />
              <Field
                label="Valor total (R$)"
                name="total"
                type="number"
                min="0.01"
                step="0.01"
                required
              />
              <Field
                label="Número de parcelas"
                name="count"
                type="number"
                min="1"
                max="120"
                required
              />
              <Field
                label="Primeira fatura"
                name="firstMonth"
                type="month"
                defaultValue={month}
                required
              />
            </>
          )}
          {type === "settle" && (
            <>
              <p className="form-hint full">
                Selecione um pagamento de cartão para associar à fatura de{" "}
                {monthName(item.month)}. Valor restante:{" "}
                {money(item.total - item.paid)}.
              </p>
              <Field label="Mês do pagamento" full>
                <input type="month" value={paymentMonth} required onChange={(e) => {
                  setPaymentMonth(e.target.value);
                  setPaymentId("");
                  setSettlementAmount("");
                  setPayments([]);
                }} />
              </Field>
              <Field label="Pagamento" full>
                <select name="paymentId" value={paymentId} required onChange={(e) => {
                  const id = e.target.value;
                  const selected = payments.find((payment) => payment.id === id);
                  setPaymentId(id);
                  const available = selected ? -selected.amount - (selected.allocatedAmount ?? 0) : 0;
                  setSettlementAmount(selected ? amount(Math.min(available, item.total - item.paid)) : "");
                }}>
                  <option value="">Selecione um pagamento</option>
                  {payments.map((payment) => (
                    <option key={payment.id} value={payment.id}>
                      {payment.description} · {dateLabel(payment.date)} ·{" "}
                      {money(-payment.amount - (payment.allocatedAmount ?? 0))} disponível
                    </option>
                  ))}
                </select>
              </Field>
              {paymentState === "loading" && paymentMonth && <p role="status" className="form-hint full">Buscando pagamentos…</p>}
              {paymentState === "failed" && <p role="alert" className="form-hint full">Não foi possível buscar os pagamentos.</p>}
              {paymentState === "ready" && payments.length === 0 && (
                <p className="form-hint full">Nenhum pagamento com saldo disponível nesse mês.</p>
              )}
              <Field
                label="Valor a conciliar (R$)"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                value={settlementAmount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettlementAmount(e.target.value)}
                required
                full
              />
            </>
          )}
        </div>
        <div className="form-actions">
          <button className="button" disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" className="button secondary" onClick={close}>
            Cancelar
          </button>
          {item &&
            ["entry", "investment", "recurrence"].includes(type) &&
            !remove && (
              <button
                type="button"
                className="button danger"
                onClick={() => setRemove(true)}
              >
                {type === "recurrence" ? "Encerrar" : "Excluir"}
              </button>
            )}
        </div>
        {remove && (
          <div className="confirm-delete">
            <p>
              {type === "recurrence"
                ? "Encerrar esta recorrência neste mês?"
                : "Excluir este item? Esta ação não pode ser desfeita."}
            </p>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() =>
                void mutate(
                  type === "entry"
                    ? { type: "deleteEntry", id: item.id }
                    : type === "investment"
                      ? { type: "deleteInvestment", id: item.id }
                      : { type: "endRecurrence", id: item.id, endMonth: month },
                )
              }
            >
              Confirmar {type === "recurrence" ? "encerramento" : "exclusão"}
            </button>
          </div>
        )}
      </form>
    </Overlay>
  );
}
export function Login({
  onSignIn,
  onPreview,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  onPreview?: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="chart" size={18} />
          </span>
          financeiro<span style={{ color: "#8daa91" }}>.</span>
        </div>
        <div className="login-copy">
          <h1>
            Seu dinheiro,
            <br />
            <em>com mais clareza.</em>
          </h1>
          <p>
            Um espaço tranquilo para cuidar da sua vida financeira, do seu
            jeito.
          </p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await onSignIn(String(f.get("email")), String(f.get("password")));
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Não foi possível entrar. Confira seus dados.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <Field
              label="E-mail"
              name="email"
              type="email"
              autoComplete="email"
              required
              full
            />
            <Field
              label="Senha"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              full
            />
          </div>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="button login-submit" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </form>
        {onPreview && (
          <>
            <div className="login-divider">
              <span>ou</span>
            </div>
            <button
              className="button secondary login-submit"
              onClick={onPreview}
            >
              Explorar demonstração
            </button>
          </>
        )}
        <p className="login-foot">
          Seu espaço pessoal para acompanhar o que importa.
        </p>
      </div>
    </main>
  );
}
