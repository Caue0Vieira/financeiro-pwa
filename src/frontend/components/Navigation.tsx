import type { Profile } from "../../contracts";
import { brandName } from "../brand";
import type { Page } from "../types";
import { Avatar, Brand, Icon, type IconName } from "./common";

export const workspace = [
  { id: "home", label: "Visão geral", icon: "home" },
  { id: "activity", label: "Transações", icon: "activity" },
  { id: "analytics", label: "Análise e Orçamento", icon: "analytics" },
  { id: "cards", label: "Cartões", icon: "card" },
  { id: "commitments", label: "Compromissos", icon: "receipt" },
  { id: "investments", label: "Investimentos", icon: "chart" },
  { id: "goals", label: "Metas", icon: "goal" },
] as const;

export const account = [
  { id: "import", label: "Importar arquivos", icon: "upload" },
  { id: "profile", label: "Perfil", icon: "user" },
] as const;

type NavigationProps = { page: Page; navigate: (page: Page) => void };

export function Sidebar({
  page,
  navigate,
  profile,
  preview,
}: NavigationProps & { profile: Profile; preview: boolean }) {
  const render = ({ id, label, icon }: { id: Page; label: string; icon: IconName }) => (
    <button key={id} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
  return (
    <aside className="sidebar">
      <button
        className="brand-link"
        onClick={() => navigate("home")}
        aria-label={`${brandName}, visão geral`}
      >
        <Brand />
      </button>
      <nav className="nav" aria-label="Finanças">
        {workspace.map(render)}
      </nav>
      <nav className="nav nav-secondary" aria-label="Conta e arquivos">
        {account.map(render)}
      </nav>
      <button className="sidebar-user" onClick={() => navigate("profile")}>
        <Avatar profile={profile} />
        <span>
          <strong>{profile.name || "Sua conta"}</strong>
          <small>{preview ? "Demonstração" : "Minha conta"}</small>
        </span>
        <Icon name="chevronRight" size={15} />
      </button>
    </aside>
  );
}

const mobileLinks = [
  { id: "home", label: "Início", icon: "house" },
  { id: "analytics", label: "Análise", icon: "analytics" },
  { id: "goals", label: "Metas", icon: "heart" },
  { id: "profile", label: "Perfil", icon: "user" },
] as const;

export function MobileNav({
  page,
  navigate,
  onAdd,
}: NavigationProps & { onAdd: () => void }) {
  const activeCol =
    page === "home"
      ? 0
      : page === "analytics"
        ? 1
        : page === "goals"
          ? 3
          : page === "profile"
            ? 4
            : -1;

  const render = ({ id, label, icon }: (typeof mobileLinks)[number]) => {
    const isActive = page === id;
    return (
      <button
        key={id}
        className={isActive ? "active" : undefined}
        aria-current={isActive ? "page" : undefined}
        onClick={() => navigate(id)}
      >
        <Icon name={icon} size={19} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav className="mobile-nav" aria-label="Navegação principal">
      {render(mobileLinks[0])}
      {render(mobileLinks[1])}
      <button
        type="button"
        className="mobile-add"
        onClick={onAdd}
        aria-label="Novo lançamento"
      >
        <Icon name="plus" size={24} />
      </button>
      {render(mobileLinks[2])}
      {render(mobileLinks[3])}
      {activeCol !== -1 && (
        <span
          className="mobile-nav-indicator"
          aria-hidden="true"
          style={{
            transform: `translateX(calc(${activeCol} * (100% + var(--mobile-nav-gap))))`,
          }}
        />
      )}
    </nav>
  );
}
