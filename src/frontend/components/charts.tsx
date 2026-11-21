import { useId, type CSSProperties } from "react";
import type { Dashboard } from "../../contracts";
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
