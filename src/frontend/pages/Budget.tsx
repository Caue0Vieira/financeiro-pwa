import type { ReactNode } from "react";
import type { Dashboard } from "../../contracts";
import { Spending } from "../components/charts";
import { HeaderMenu, PageHeading } from "../components/common";
import { money } from "../format";
import type { OpenEditor } from "../types";

export default function Budget({
  data,
  monthControl,
  openEditor,
}: {
  data: Dashboard;
  monthControl: ReactNode;
  openEditor: OpenEditor;
}) {
  const spent = Math.max(0, data.expenses);
  const remaining = data.budget - spent;
  const used = data.budget > 0 ? (spent / data.budget) * 100 : 0;
  return (
    <>
      <PageHeading
        title="Orçamento"
        action={
          <HeaderMenu icon="settingsGear" label="Selecionar mês do orçamento">
            {monthControl}
          </HeaderMenu>
        }
      />
      <div className="screen-stack budget-layout">
        <section className="feature-card budget-card">
          <div className="panel-head">
            <div>
              <span>Limite de gastos do mês</span>
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
        <Spending categories={data.categories} total={data.expenses} />
      </div>
    </>
  );
}
