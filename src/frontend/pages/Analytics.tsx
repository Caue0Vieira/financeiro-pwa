import { useEffect, useState } from "react";
import type { AnalysisPeriod, Dashboard, FinanceService, SpendingAnalysis, Summaries } from "../../contracts";
import { currentMonth, dateInMonth, shiftMonth, todayInSaoPaulo } from "../../date";
import { Icon, categoryAppearance } from "../components/common";
import { AnalyticsSkeleton } from "../components/Skeleton";
import { SummaryHistory } from "../components/SummaryCard";
import { dateLabel, money, monthName } from "../format";

const periods = [
  ["week", "Semana"],
  ["month", "Mês"],
  ["year", "Ano"],
] as const;
const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const axisMoney = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export default function Analytics({
  month,
  analyze,
  revision,
  onViewTransactions,
  summaries,
}: {
  summaries?: Summaries;
  month: string;
  analyze: FinanceService["analysis"];
  revision: Dashboard;
  onViewTransactions: () => void;
}) {
  const [period, setPeriod] = useState<AnalysisPeriod>("month");
  const [analysis, setAnalysis] = useState<SpendingAnalysis>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [activeDate, setActiveDate] = useState<string>();
  const anchor = month === currentMonth() ? todayInSaoPaulo() : dateInMonth(month, 31);

  useEffect(() => {
    let current = true;
    setAnalysis(undefined);
    setError(false);
    setActiveDate(undefined);
    void analyze(anchor, period)
      .then((result) => {
        if (current) setAnalysis(result);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [analyze, anchor, period, attempt, revision]);

  const points =
    period === "month"
      ? Array.from({ length: 6 }, (_, index) => {
          const itemMonth = shiftMonth(month, index - 5);
          return {
            date: itemMonth + "-01",
            amount: revision.trend.find((point) => point.month === itemMonth)?.expenses ?? 0,
          };
        })
      : (analysis?.points ?? []);
  const point =
    points.find(({ date }) => date === activeDate) ??
    points.findLast(({ date }) => date <= anchor) ??
    points[0];
  const peak = Math.max(1, ...points.map(({ amount }) => amount));
  const step = 10 ** Math.floor(Math.log10(peak));
  const max = Math.max(10000, Math.ceil(peak / step) * step);
  const change =
    analysis && analysis.previous > 0
      ? ((analysis.total - analysis.previous) / analysis.previous) * 100
      : undefined;
  const spending = analysis?.categories.filter(({ amount }) => amount > 0) ?? [];
  const categoryTotal = spending.reduce((sum, { amount }) => sum + amount, 0);

  return (
    <>
      <div className="segmented period-tabs" role="group" aria-label="Período da análise">
        {periods.map(([value, label]) => (
          <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="panel">
          <p role="alert">Não foi possível carregar a análise.</p>
          <button className="text-button" onClick={() => setAttempt((n) => n + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {!analysis && !error && <AnalyticsSkeleton />}
      {analysis && (
        <div className="analytics-layout">
          <section className="panel analysis-chart">
            <header className="analysis-total">
              <span>Total gasto</span>
              <strong>{money(analysis.total)}</strong>
              {change !== undefined && (
                <p className={change <= 0 ? "income" : "expense-change"}>
                  <Icon name={change <= 0 ? "arrowDown" : "arrowUp"} size={15} />
                  {change === 0
                    ? "Igual ao período anterior"
                    : `${Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% a ${change < 0 ? "menos" : "mais"} que no período anterior`}
                </p>
              )}
            </header>
            <div className="spend-chart">
              <div className="spend-axis" aria-hidden="true">
                {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
                  <span key={fraction}>{axisMoney.format((max * fraction) / 100)}</span>
                ))}
              </div>
              <div className="spend-plot">
                <div className="chart-lines" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                {points.map(({ date, amount }) => {
                  const label =
                    period === "week"
                      ? date.slice(8)
                      : monthShort.format(new Date(date + "T12:00:00Z")).slice(0, 3);
                  const height = (Math.max(0, amount) / max) * 100;
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-label={`${period === "week" ? dateLabel(date) : monthName(date.slice(0, 7))}, ${money(amount)}`}
                      aria-pressed={point?.date === date}
                      onClick={() => setActiveDate(date)}
                    >
                      <span className="spend-bar-track" aria-hidden="true">
                        <i style={{ height: `${height}%` }} />
                        {point?.date === date && (
                          <span className="spend-pop" style={{ bottom: `calc(${height}% + 8px)` }}>
                            {money(amount)}
                          </span>
                        )}
                      </span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
          <section className="panel screen-list">
            <header className="panel-head">
              <h2>Categorias no período</h2>
              <button className="text-button" onClick={onViewTransactions}>
                Ver todas <Icon name="arrowRight" size={14} />
              </button>
            </header>
            {spending.length === 0 && <p className="empty">Nenhuma despesa por categoria neste período.</p>}
            {spending.map(({ name, amount }) => {
              const appearance = categoryAppearance(name);
              return (
                <div className="transaction" key={name}>
                  <span className="transaction-icon" data-category={appearance.tone}>
                    <Icon name={appearance.icon} />
                  </span>
                  <div className="transaction-info">
                    <strong>{name}</strong>
                  </div>
                  <span className="category-percent">{Math.round((amount / categoryTotal) * 100)}%</span>
                  <strong className="transaction-amount">{money(amount)}</strong>
                </div>
              );
            })}
          </section>
        </div>
      )}
      {summaries && <SummaryHistory summaries={summaries} />}
    </>
  );
}
