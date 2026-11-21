import { useEffect, useState } from "react";
import type { MonthlySummary, Summaries } from "../../contracts";
import { currentMonth, shiftMonth } from "../../date";
import { monthLabel, monthOnly } from "../../summary";
import { dateLabel, money } from "../format";
import { Icon } from "./common";

/** The numbers of a monthly summary (computed by the app) and the comment. */
export function SummaryDetails({ summary, onSetGoal }: { summary: MonthlySummary; onSetGoal?: () => void }) {
  return (
    <>
      <p className="summary-text">{summary.text}</p>
      <dl className="summary-totals">
        <div>
          <dt>Entradas</dt>
          <dd className="income">{money(summary.income)}</dd>
        </div>
        <div>
          <dt>Saídas</dt>
          <dd>{money(summary.expenses)}</dd>
        </div>
        <div>
          <dt>Saldo</dt>
          <dd className={summary.balance < 0 ? "negative" : "income"}>{money(summary.balance)}</dd>
        </div>
      </dl>
      {summary.growth.length > 0 && (
        <div className="summary-block">
          <h3>O que mais cresceu</h3>
          <ul>
            {summary.growth.map((item) => (
              <li key={item.category}>
                <span>{item.category}</span>
                <strong>+{money(item.amount - item.previous)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="summary-facts">
        <p>
          <Icon name={summary.goalMet ? "check" : "goal"} size={16} />
          {summary.goalMet === null
            ? "Sem meta de economia no mês."
            : summary.goalMet
              ? `Meta de economia de ${money(summary.goal)} batida.`
              : `Meta de economia de ${money(summary.goal)} não batida.`}
          {summary.goalMet === null && onSetGoal && (
            <button type="button" className="text-button" onClick={onSetGoal}>Definir meta</button>
          )}
        </p>
        {summary.largest && (
          <p>
            <Icon name="receipt" size={16} />
            Maior gasto: {summary.largest.description}, {money(summary.largest.amount)} em {dateLabel(summary.largest.date)}.
          </p>
        )}
      </div>
    </>
  );
}

/** Home screen card for last month's summary, until dismissed. */
export function SummaryCard({
  summary,
  onDismiss,
  onHistory,
  onSetGoal,
}: {
  summary: MonthlySummary;
  onDismiss: () => void;
  onHistory: () => void;
  onSetGoal: () => void;
}) {
  return (
    <section className="panel summary-card" aria-labelledby="summary-card-title">
      <header className="panel-head">
        <div>
          <p>Resumo mensal</p>
          <h2 id="summary-card-title">Seu {monthLabel(summary.month)}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onDismiss} aria-label={`Dispensar resumo de ${monthOnly(summary.month)}`}>
          <Icon name="close" size={17} />
        </button>
      </header>
      <SummaryDetails summary={summary} onSetGoal={onSetGoal} />
      <button type="button" className="text-button" onClick={onHistory}>
        Ver resumos anteriores <Icon name="arrowRight" size={15} />
      </button>
    </section>
  );
}

/** Análise → history of the monthly summaries. */
export function SummaryHistory({ summaries }: { summaries: Summaries }) {
  const [items, setItems] = useState<MonthlySummary[]>();
  const [state, setState] = useState<"loading" | "ready" | "failed" | "generating">("loading");
  const [attempt, setAttempt] = useState(0);
  const lastMonth = shiftMonth(currentMonth(), -1);

  useEffect(() => {
    let active = true;
    setState("loading");
    summaries.list()
      .then((list) => {
        if (!active) return;
        setItems(list);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
  }, [summaries, attempt]);

  async function generate() {
    setState("generating");
    try {
      const summary = await summaries.generate();
      setItems((list) => (summary ? [summary, ...(list ?? []).filter(({ month }) => month !== summary.month)] : list));
      setState("ready");
    } catch {
      setState("failed");
    }
  }

  const missingLast = state !== "loading" && items && !items.some(({ month }) => month === lastMonth);
  return (
    <section className="panel summary-history" aria-labelledby="summary-history-title">
      <header className="panel-head">
        <div>
          <h2 id="summary-history-title">Resumos mensais</h2>
          <p>Chegam no dia 1 com o fechamento do mês anterior.</p>
        </div>
      </header>
      {state === "loading" && <p className="empty">Carregando resumos…</p>}
      {state === "failed" && (
        <div className="empty" role="alert">
          {navigator.onLine ? "Não foi possível carregar os resumos." : "Sem conexão. Os resumos aparecem quando a internet voltar."}{" "}
          <button type="button" className="text-button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button>
        </div>
      )}
      {missingLast && (
        <p className="summary-missing">
          O resumo de {monthOnly(lastMonth)} ainda não foi gerado.{" "}
          <button type="button" className="text-button" disabled={state === "generating"} onClick={() => void generate()}>
            {state === "generating" ? "Gerando…" : "Gerar agora"}
          </button>
        </p>
      )}
      {items?.length === 0 && state === "ready" && !missingLast && <p className="empty">Nenhum resumo ainda.</p>}
      {items?.map((summary, index) => (
        <details key={summary.month} className="summary-entry" open={index === 0}>
          <summary>
            <strong>{monthLabel(summary.month)}</strong>
            <span className={summary.balance < 0 ? "negative" : "income"}>{money(summary.balance)}</span>
            <Icon name="chevronRight" size={16} />
          </summary>
          <SummaryDetails summary={summary} />
        </details>
      ))}
    </section>
  );
}
