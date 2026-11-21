import { Icon, PageHeading } from "../components/common";
import { account, workspace } from "../components/Navigation";
import type { Page } from "../types";

const shortcuts: Partial<Record<Page, { detail: string; tone: string }>> = {
  activity: { detail: "Histórico e busca", tone: "mint" },
  cards: { detail: "Bancos e vencimentos", tone: "teal" },
  commitments: { detail: "Contas e parcelas", tone: "peach" },
  investments: { detail: "Carteira e evolução", tone: "blue" },
  assistant: { detail: "Simular compras e tirar dúvidas", tone: "violet" },
};

export default function More({
  navigate,
}: {
  navigate: (page: Page) => void;
}) {
  return (
    <div className="more-page">
      <PageHeading title="Mais" />
      <nav className="more-shortcuts" aria-label="Atalhos financeiros">
        {workspace.map(({ id, label, icon }) => {
          const shortcut = shortcuts[id];
          if (!shortcut) return null;

          return (
            <button
              className="more-shortcut"
              key={id}
              type="button"
              aria-label={label}
              aria-describedby={`more-${id}-detail`}
              onClick={() => navigate(id)}
            >
              <span className={`tile-icon tone-${shortcut.tone}`}><Icon name={icon} /></span>
              <Icon name="arrowRight" size={17} />
              <span className="more-shortcut-label">
                <strong>{label}</strong>
                <small id={`more-${id}-detail`}>{shortcut.detail}</small>
              </span>
            </button>
          );
        })}
      </nav>
      <nav className="more-account" aria-label="Conta e arquivos">
        {account.map(({ id, label, icon }) => (
          <button key={id} type="button" onClick={() => navigate(id)}>
            <Icon name={icon} size={18} />
            <span>{label}</span>
            <Icon name="chevronRight" size={16} />
          </button>
        ))}
      </nav>
    </div>
  );
}
