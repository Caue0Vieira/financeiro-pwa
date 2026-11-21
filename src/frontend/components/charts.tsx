import { useId, type CSSProperties } from "react";
import type { BalanceForecast, Dashboard } from "../../contracts";
import { money } from "../format";

export function Spending({ categories, total }: { categories: Dashboard["categories"]; total: number }) {
  const headingId = useId();
  const sorted = [...categories].filter(({ amount }) => amount > 0).sort((a, b) => b.amount - a.amount);
  const shared =
    sorted.length <= 6
      ? sorted
      : [
          ...sorted.slice(0, 5),
          { name: "Outros", amount: sorted.slice(5).reduce((sum, { amount }) => sum + amount, 0) },
        ];
  const slices = shared;
  const sum = slices.reduce((amount, item) => amount + item.amount, 0);
  let start = 0;
  const segments = slices.map((item, index) => {
    const end = start + (item.amount / sum) * 100;
    const color = `var(--chart-category-${index + 1})`;
    const segment = { ...item, color, stop: `${color} ${start}% ${end}%`, share: Math.round(end - start) };
    start = end;
    return segment;
  });

  return (
    <section className="panel spending-panel" aria-labelledby={headingId}>
      <header className="panel-head">
        <div>
          <h2 id={headingId}>Despesas por categoria</h2>
        </div>
      </header>
      {segments.length === 0 ? (
        <p className="empty">Nenhuma despesa por categoria neste mês.</p>
      ) : (
        <>
          <div
            className="donut"
            style={{ "--segments": segments.map(({ stop }) => stop).join(", ") } as CSSProperties}
          >
            <div>
              <strong>{money(total)}</strong>
              <span>gastos</span>
            </div>
          </div>
          <ul className="category-list">
            {segments.map(({ name, amount, color, share }, index) => (
              <li key={`${name}-${index}`}>
                <span>
                  <i style={{ background: color }} aria-hidden="true" />
                  {name}
                </span>
                <strong title={money(amount)}>{share}%</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const shortDate = (date: string) => `${Number(date.slice(8, 10))}/${date.slice(5, 7)}`;

/**
 * Balance of the month day by day: solid line up to today (real), dashed after (projected), with
 * the zero line when the balance goes below it and a mark on the first negative day.
 */
export function BalanceChart({ forecast }: { forecast: BalanceForecast }) {
  const titleId = useId();
  const width = 320;
  const height = 132;
  const pad = { top: 10, right: 8, bottom: 20, left: 8 };
  const { points } = forecast;
  const values = points.map(({ balance }) => balance);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const span = top - bottom || 1;
  const x = (index: number) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + ((top - value) / span) * (height - pad.top - pad.bottom);
  const todayIndex = Math.max(0, points.findLastIndex(({ projected }) => !projected));
  const path = (from: number, to: number) =>
    points.slice(from, to + 1).map((point, offset) => `${offset ? "L" : "M"}${x(from + offset).toFixed(1)},${y(point.balance).toFixed(1)}`).join(" ");
  const negativeIndex = forecast.negativeOn ? points.findIndex(({ date }) => date === forecast.negativeOn) : -1;
  const label = `Saldo hoje ${money(forecast.today)}; previsto para o fim do mês ${money(forecast.end)}`
    + (forecast.negativeOn ? `; fica negativo no dia ${Number(forecast.negativeOn.slice(8, 10))}.` : ".");
  return (
    <figure className="balance-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{label}</title>
        {bottom < 0 && (
          <line className="balance-zero" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        )}
        <path className="balance-real" d={path(0, todayIndex)} />
        {todayIndex < points.length - 1 && <path className="balance-projected" d={path(todayIndex, points.length - 1)} />}
        <circle className="balance-today" cx={x(todayIndex)} cy={y(points[todayIndex].balance)} r={4} />
        {negativeIndex >= 0 && (
          <circle className="balance-negative" cx={x(negativeIndex)} cy={y(points[negativeIndex].balance)} r={4.5} />
        )}
        <text x={pad.left} y={height - 4} className="balance-axis">{shortDate(points[0].date)}</text>
        <text x={x(todayIndex)} y={height - 4} className="balance-axis" textAnchor="middle">Hoje</text>
        <text x={width - pad.right} y={height - 4} className="balance-axis" textAnchor="end">{shortDate(points[points.length - 1].date)}</text>
      </svg>
      <figcaption>
        <span><i className="legend-real" aria-hidden="true" /> Real</span>
        <span><i className="legend-projected" aria-hidden="true" /> Previsto</span>
      </figcaption>
    </figure>
  );
}
