import { useState } from "react";
import type { Dashboard } from "../../contracts";
import { Icon, PageHeading, type IconName } from "../components/common";
import { money } from "../format";
import type { OpenEditor } from "../types";

const suggestions: { name: string; icon: IconName; tone: string }[] = [
  { name: "Reserva de emergência", icon: "shield", tone: "mint" },
  { name: "Viagem de férias", icon: "plane", tone: "blue" },
  { name: "Notebook novo", icon: "laptop", tone: "violet" },
  { name: "Entrada da casa", icon: "house", tone: "peach" },
];

export default function Goals({ data, openEditor }: { data: Dashboard; openEditor: OpenEditor }) {
  const [tab, setTab] = useState<"mine" | "ideas">("mine");
  return (
    <>
      <PageHeading
        title="Metas financeiras"
        action={
          <button
            className="button screen-heading-action"
            onClick={() => openEditor({ type: "target" })}
            aria-label="Nova meta"
          >
            <Icon name="plus" size={21} />
            <span>Nova meta</span>
          </button>
        }
      />
      <section className="goals-banner">
        <h2>
          Construa
          <br />
          seu futuro
        </h2>
        <p>Defina metas e acompanhe cada aporte.</p>
      </section>
      <div className="segmented period-tabs" role="group" aria-label="Tipo de meta">
        <button aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>
          Minhas metas
        </button>
        <button aria-pressed={tab === "ideas"} onClick={() => setTab("ideas")}>
          Sugestões
        </button>
      </div>
      {tab === "mine" ? (
        <section className="panel screen-list target-list" aria-label="Minhas metas">
          {!data.targets.length && (
            <p className="empty">Crie sua primeira meta para acompanhar quanto já guardou.</p>
          )}
          {data.targets.map((item, index) => {
            const design =
              suggestions.find(({ name }) => name === item.name) ?? suggestions[index % suggestions.length];
            const percentage = Math.max(0, (item.saved / item.amount) * 100);
            return (
              <button
                type="button"
                className="target-row reference-target-row"
                key={item.id}
                onClick={() => openEditor({ type: "target", item })}
                aria-label={`Editar ${item.name}, ${Math.round(percentage)}% concluído`}
              >
                <span className={`transaction-icon tone-${design.tone}`}>
                  <Icon name={design.icon} />
                </span>
                <span className="target-main">
                  <strong>{item.name}</strong>
                  <span>
                    {money(item.saved)} de {money(item.amount)}
                  </span>
                  <span className="target-progress">
                    <progress
                      aria-label={`Progresso de ${item.name}`}
                      value={Math.min(100, percentage)}
                      max={100}
                    />
                    <span>{Math.round(percentage)}%</span>
                  </span>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
            );
          })}
        </section>
      ) : (
        <section className="panel screen-list more-links" aria-label="Sugestões de metas">
          {suggestions.map(({ name, icon, tone }) => (
            <button
              key={name}
              onClick={() => {
                setTab("mine");
                openEditor({ type: "target", name });
              }}
            >
              <span className={`tile-icon tone-${tone}`}>
                <Icon name={icon} />
              </span>
              <strong>{name}</strong>
              <Icon name="plus" size={17} />
            </button>
          ))}
        </section>
      )}
    </>
  );
}
