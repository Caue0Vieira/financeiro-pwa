import type { CSSProperties, ReactNode } from "react";
import type { Dashboard as DashboardData } from "../../contracts";
import { Avatar, Entries, EntryRow, Icon, type IconName } from "../components/common";
import { HomeCardArt } from "../components/HomeCardArt";
import { SummaryCard } from "../components/SummaryCard";
import { ForecastPanel } from "../components/ForecastPanel";
import { addDays, todayInSaoPaulo } from "../../date";
import { dateLabel, money } from "../format";
import type { OpenEditor, Page } from "../types";

export default function Dashboard({
  data,
  monthControl,
  invoiceReminders,
  openEditor,
  navigate,
  balanceVisible,
  onToggleBalance,
  onDismissSummary,
  onSummaryHistory,
}: {
  data: DashboardData;
  monthControl: ReactNode;
  invoiceReminders: ReactNode;
  openEditor: OpenEditor;
  navigate: (page: Page) => void;
  balanceVisible: boolean;
  onToggleBalance: () => void;
  onDismissSummary: (month: string) => void;
  onSummaryHistory: () => void;
}) {
  const name = data.profile.name.trim();
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "America/Fortaleza",
    }).format(),
  );
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const editEntry = (item: DashboardData["recent"][number]) => openEditor({ type: "entry", item });
  // New entries go through the "Novo" button (tab bar / top bar); these are shortcuts to screens.
  const actions: { icon: IconName; label: string; action: () => void }[] = [
    { icon: "chart", label: "Investir", action: () => navigate("investments") },
    { icon: "receipt", label: "Contas", action: () => navigate("commitments") },
    { icon: "card", label: "Cartões", action: () => navigate("cards") },
    { icon: "more", label: "Mais", action: () => navigate("more") },
  ];
  const confirmedBalance = data.received - data.expenses;
  const balanceText = balanceVisible ? money(data.projectedSurplus) : "••••••";
  const today = todayInSaoPaulo();
  const yesterday = addDays(today, -1);

  return (
    <>
      <header className="home-heading">
        <div>
          <p>{greeting}</p>
          <h1 tabIndex={-1}>{name || "Visão geral"}</h1>
        </div>
        <div className="home-heading-actions">
          <div className="home-period">{monthControl}</div>
          <button
            className="profile-action home-avatar"
            onClick={() => navigate("profile")}
            aria-label="Abrir perfil"
          >
            <Avatar profile={data.profile} />
          </button>
        </div>
      </header>
      <div className="home-layout">
        <div className="home-hero-stack">
          <section className="home-balance" aria-label="Saldo do mês">
            <div className="home-balance-content">
              <span className="home-balance-label">Saldo previsto</span>
              <div className="home-balance-amount">
                <strong style={{ "--amount-chars": balanceText.length } as CSSProperties}>{balanceText}</strong>
                <button
                  type="button"
                  onClick={onToggleBalance}
                  aria-label={balanceVisible ? "Ocultar saldo previsto" : "Mostrar saldo previsto"}
                >
                  <Icon name={balanceVisible ? "eye" : "eyeOff"} size={16} />
                </button>
              </div>
              {balanceVisible && (
                <p className="home-confirmed">
                  <Icon name={confirmedBalance >= 0 ? "arrowUp" : "arrowDown"} size={14} />
                  <strong>
                    {confirmedBalance > 0 ? "+" : ""}
                    {money(confirmedBalance)}
                  </strong>{" "}
                  confirmado no mês
                </p>
              )}
            </div>
            <HomeCardArt data={data} />
          </section>
          <div className="home-quick-actions" aria-label="Ações rápidas">
            {actions.map(({ icon, label, action }) => (
              <button key={label} onClick={action}>
                <span>
                  <Icon name={icon} size={22} />
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>
        <section className="panel home-summary" aria-label="Resumo mensal">
          <h2>Neste mês</h2>
          <dl>
            <div>
              <dt>Recebido</dt>
              <dd className="income">{money(data.received)}</dd>
            </div>
            <div>
              <dt>Despesas</dt>
              <dd>{money(data.expenses)}</dd>
            </div>
            <div>
              <dt>A pagar</dt>
              <dd>{money(data.toPay)}</dd>
            </div>
          </dl>
          <button className="text-button" onClick={() => navigate("analytics")}>
            Ver análise <Icon name="arrowRight" size={15} />
          </button>
        </section>
        <div className="screen-stack home-main-stack">
          {data.summary && !data.summary.dismissed && (
            <SummaryCard
              summary={data.summary}
              onDismiss={() => onDismissSummary(data.summary!.month)}
              onHistory={onSummaryHistory}
              onSetGoal={() => openEditor({ type: "goal" })}
            />
          )}
          {data.forecast && <ForecastPanel forecast={data.forecast} onOpenBills={() => navigate("commitments")} />}
          {invoiceReminders}
          <section className="panel recent-panel screen-list">
            <header className="panel-head">
              <h2>Transações recentes</h2>
              <button className="text-button" onClick={() => navigate("activity")}>
                Ver todas <Icon name="arrowRight" size={15} />
              </button>
            </header>
            {data.recent.length ? (
              data.recent
                .slice(0, 4)
                .map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onEdit={editEntry}
                    compact
                    dateText={
                      entry.date === today
                        ? "Hoje"
                        : entry.date === yesterday
                          ? "Ontem"
                          : dateLabel(entry.date)
                    }
                  />
                ))
            ) : (
              <Entries entries={[]} onEdit={editEntry} />
            )}
          </section>
        </div>
        <aside className="screen-stack home-aside" aria-label="Patrimônio e vencimentos">
          <section className="panel overview-investment">
            <header className="panel-head">
              <div>
                <h2>Investimentos</h2>
                <p>Patrimônio informado</p>
              </div>
              <button
                className="icon-button"
                onClick={() => navigate("investments")}
                aria-label="Abrir investimentos"
              >
                <Icon name="arrowUp" />
              </button>
            </header>
            <strong className="overview-total">{money(data.invested)}</strong>
          </section>
          <section className="panel upcoming-panel">
            <header className="panel-head">
              <h2>Próximos vencimentos</h2>
              <button className="text-button" onClick={() => navigate("commitments")}>
                Ver contas a pagar <Icon name="arrowRight" size={15} />
              </button>
            </header>
            <Entries
              entries={data.upcoming.slice(0, 3)}
              onEdit={editEntry}
              empty="Nenhuma conta prevista neste mês."
            />
          </section>
        </aside>
      </div>
    </>
  );
}
