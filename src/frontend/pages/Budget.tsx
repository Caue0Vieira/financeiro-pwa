import type { Dashboard } from "../../contracts";
import { Spending } from "../components/charts";
import { money } from "../format";
import { Icon } from "../components/common";
import type { OpenEditor } from "../types";

export default function Budget({
  data,
  openEditor,
}: {
  data: Dashboard;
  openEditor: OpenEditor;
}) {
  const spent = Math.max(0, data.expenses);
  const remaining = data.budget - spent;
  const used = data.budget > 0 ? (spent / data.budget) * 100 : 0;

  return (
    <div className="screen-stack budget-layout">
      <section className="feature-card budget-card">
        <div className="panel-head">
          <div>
            <span>Planejamento e limite do mês</span>
            <strong>{data.budget ? money(data.budget) : "Sem limite definido"}</strong>
          </div>
          <button className="feature-button" onClick={() => openEditor({ type: "budget" })}>
            {data.budget ? "Editar" : "Definir"}
          </button>
        </div>
        {data.budget > 0 && (
          <>
            <progress aria-label="Limite mensal usado" value={Math.min(100, used)} max={100} />
            <div className="split">
              <span>{money(spent)} gastos</span>
              <span>
                {money(Math.abs(remaining))} {remaining < 0 ? "acima do limite" : "restantes"}
              </span>
            </div>
          </>
        )}
      </section>
      <CategoryLimits data={data} openEditor={openEditor} />
      <Spending categories={data.categories} total={data.expenses} />
    </div>
  );
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Limits per category (the same every month); the push notice comes at 80% and 100%. */
function CategoryLimits({ data, openEditor }: { data: Dashboard; openEditor: OpenEditor }) {
  const spentOf = (category: string) =>
    data.categories.filter(({ name }) => fold(name) === fold(category)).reduce((sum, { amount }) => sum + amount, 0);
  return (
    <section className="panel category-limits" aria-labelledby="category-limits-title">
      <header className="panel-head">
        <div>
          <h2 id="category-limits-title">Limites por categoria</h2>
          <p>Valem para todos os meses. Você recebe um aviso aos 80% e aos 100%.</p>
        </div>
        <button className="text-button" onClick={() => openEditor({ type: "category-budget" })}>
          <Icon name="plus" size={15} /> Adicionar
        </button>
      </header>
      {data.categoryBudgets.length === 0 ? (
        <p className="empty">Nenhum limite por categoria. Defina um para acompanhar as categorias que mais pesam.</p>
      ) : (
        <ul className="category-limit-list">
          {data.categoryBudgets.map((item) => {
            const spent = Math.max(0, spentOf(item.category));
            const used = Math.round((spent / item.amount) * 100);
            return (
              <li key={item.category}>
                <button type="button" onClick={() => openEditor({ type: "category-budget", item })} aria-label={`Editar limite de ${item.category}`}>
                  <span className="category-limit-head">
                    <strong>{item.category}</strong>
                    <span data-level={used >= 100 ? "over" : used >= 80 ? "near" : undefined}>{used}%</span>
                  </span>
                  <progress value={Math.min(100, used)} max={100} aria-hidden="true" />
                  <small>{money(spent)} de {money(item.amount)}</small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
