import { useId, useState } from "react";
import type { Dashboard, Investment, Valuation } from "../../contracts";
import { shiftMonth, todayInSaoPaulo } from "../../date";
import { Icon, PageHeading } from "../components/common";
import { dateLabel, money } from "../format";
import type { OpenEditor } from "../types";

const ranges = [
  [1, "1M"],
  [3, "3M"],
  [6, "6M"],
  [12, "1A"],
  [0, "Tudo"],
] as const;

function PortfolioChart({ series }: { series: Valuation[] }) {
  const gradient = useId();
  if (series.length < 2)
    return <p className="empty">Registre avaliações em datas diferentes para ver a evolução.</p>;
  const values = series.map(({ value }) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const timeline = series.map(({ date }) => Date.parse(date + "T00:00:00Z"));
  const first = timeline[0];
  const duration = timeline.at(-1)! - first;
  const points = series.map(({ value }, index) => ({
    x: 2 + ((timeline[index] - first) / Math.max(1, duration)) * 314,
    y: 87 - ((value - low) / Math.max(1, high - low)) * 67,
  }));
  const polyline = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const latest = points.at(-1)!;
  return (
    <figure className="portfolio-chart">
      <svg
        viewBox="0 0 320 104"
        role="img"
        aria-label={`Patrimônio de ${money(values[0])} a ${money(values.at(-1)!)} no período`}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--portfolio-line)" stopOpacity=".26" />
            <stop offset="1" stopColor="var(--portfolio-line)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon fill={`url(#${gradient})`} points={`2,104 ${polyline} 316,104`} />
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--portfolio-line)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={latest.x} cy={latest.y} r="3" fill="var(--portfolio-line)" />
      </svg>
      <figcaption>
        <span>{dateLabel(series[0].date)}</span>
        <span>{dateLabel(series.at(-1)!.date)}</span>
      </figcaption>
    </figure>
  );
}

const quotedTime = (iso: string) => {
  const zone = { timeZone: "America/Sao_Paulo" } as const;
  const day = new Date(iso).toLocaleDateString("en-CA", zone);
  const time = new Date(iso).toLocaleTimeString("pt-BR", { ...zone, hour: "2-digit", minute: "2-digit" });
  return day === todayInSaoPaulo() ? `às ${time}` : `em ${dateLabel(day)}`;
};

/** A ticker saved but not quoted yet: its value is 0 until the first quote. */
const awaitingQuote = (item: Investment) => Boolean(item.ticker) && !item.price;

function holdingDetail(item: Investment) {
  if (!item.ticker || !item.quantity) return item.institution || "Instituição não informada";
  const units = `${item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 8 })} ${item.quantity === 1 ? "cota" : "cotas"}`;
  if (!item.price) return `${item.ticker} · ${units} · aguardando cotação`;
  return `${item.ticker} · ${units} × ${money(item.price)}${item.quotedAt ? ` · ${quotedTime(item.quotedAt)}` : ""}`;
}

export default function Investments({
  data,
  setModal,
  refreshQuotes,
}: {
  data: Dashboard;
  setModal: OpenEditor;
  refreshQuotes: () => Promise<void>;
}) {
  const [range, setRange] = useState<(typeof ranges)[number][0]>(1);
  const [refreshing, setRefreshing] = useState(false);
  const hasTickers = data.investments.some(({ ticker }) => ticker);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshQuotes();
    } finally {
      setRefreshing(false);
    }
  };
  const contributed = data.investments.reduce((sum, item) => sum + item.contributed, 0);
  const today = todayInSaoPaulo();
  const from = range ? shiftMonth(today.slice(0, 7), 1 - range) + "-01" : "";
  const series = data.valuations.filter(({ date }) => date >= from);
  const startValue = series[0]?.value ?? 0;
  const movement = series.length > 1 ? series.at(-1)!.value - startValue : undefined;
  return (
    <>
      <PageHeading
        title="Investimentos"
        action={
          <button className="icon-button" onClick={() => setRange(0)} aria-label="Ver todo o histórico">
            <Icon name="chart" size={20} />
          </button>
        }
      />
      <section className="panel portfolio-overview">
        <header className="analysis-total">
          <span>Patrimônio investido</span>
          <strong>{money(data.invested)}</strong>
          {movement !== undefined ? (
            <p className={movement >= 0 ? "income" : "expense-change"}>
              <Icon name={movement >= 0 ? "arrowUp" : "arrowDown"} size={15} />
              {movement > 0 ? "+" : ""}
              {money(movement)}
              {startValue > 0
                ? ` (${(movement / startValue).toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 1 })})`
                : ""}{" "}
              no período
            </p>
          ) : (
            contributed > 0 && (
              <p className={data.invested >= contributed ? "income" : "expense-change"}>
                {money(data.invested - contributed)} sobre o valor aplicado
              </p>
            )
          )}
        </header>
        <PortfolioChart series={series} />
      </section>
      <div className="segmented period-tabs portfolio-tabs" role="group" aria-label="Período da carteira">
        {ranges.map(([value, label]) => (
          <button
            key={value}
            aria-label={value ? `${value} ${value === 1 ? "mês" : "meses"}` : "Tudo"}
            aria-pressed={range === value}
            onClick={() => setRange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="panel screen-list portfolio-list">
        <header className="panel-head">
          <h2>Sua carteira</h2>
          {hasTickers && (
            <button className="text-button" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}>
              {refreshing ? "Atualizando…" : "Atualizar cotações"}
            </button>
          )}
        </header>
        {data.investments.length === 0 ? (
          <p className="empty">Adicione seu primeiro investimento para acompanhar seu patrimônio.</p>
        ) : (
          data.investments.map((item, index) => (
            <button
              key={item.id}
              className="transaction portfolio-row"
              onClick={() => setModal({ type: "investment", item })}
              aria-label={`Editar ${item.name}`}
            >
              <span className="transaction-icon" data-portfolio-tone={index % 3}>
                <Icon name={index % 3 === 0 ? "chart" : index % 3 === 1 ? "piggy" : "wallet"} />
              </span>
              <span className="transaction-info">
                <strong>{item.name}</strong>
                <span>{holdingDetail(item)}</span>
              </span>
              <span className="portfolio-value">
                <strong className="transaction-amount">{money(item.value)}</strong>
                {item.contributed > 0 && !awaitingQuote(item) && (
                  <small className={item.value >= item.contributed ? "income" : "expense-change"}>
                    {((item.value - item.contributed) / item.contributed).toLocaleString("pt-BR", {
                      style: "percent",
                      maximumFractionDigits: 1,
                      signDisplay: "exceptZero",
                    })}
                  </small>
                )}
              </span>
            </button>
          ))
        )}
      </section>
      <button className="button reference-investment-cta" onClick={() => setModal({ type: "investment" })}>
        Adicionar investimento <Icon name="arrowRight" size={17} />
      </button>
    </>
  );
}
