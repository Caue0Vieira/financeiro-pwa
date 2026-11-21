import { motion } from "motion/react";
import type { Profile } from "../../contracts";
import { brandName } from "../brand";
import type { Page } from "../types";
import { iosSpring } from "../motion/liquid";
import { Avatar, Brand, Icon, type IconName } from "./common";

export const workspace = [
  { id: "home", label: "Visão geral", icon: "home" },
  { id: "activity", label: "Transações", icon: "activity" },
  { id: "analytics", label: "Orçamento e Análise", icon: "budget" },
  { id: "cards", label: "Bancos", icon: "bank" },
  { id: "commitments", label: "Contas a pagar", icon: "receipt" },
  { id: "subscriptions", label: "Assinaturas", icon: "repeat" },
  { id: "investments", label: "Investimentos", icon: "chart" },
  { id: "goals", label: "Metas", icon: "goal" },
  { id: "assistant", label: "Assistente", icon: "sparkles" },
] as const;

export const account = [
  { id: "import", label: "Importar arquivos", icon: "upload" },
  { id: "connections", label: "Open Finance", icon: "bank" },
  { id: "profile", label: "Perfil", icon: "user" },
] as const;

type NavigationProps = { page: Page; navigate: (page: Page) => void };

export function Sidebar({
  page,
  navigate,
  profile,
  preview,
}: NavigationProps & { profile: Profile; preview: boolean }) {
  // A commitment's own screen still belongs to "Contas a pagar".
  const current = page === "commitment-detail" ? "commitments" : page;
  const render = ({ id, label, icon }: { id: Page; label: string; icon: IconName }) => (
    <button key={id} aria-current={current === id ? "page" : undefined} onClick={() => navigate(id)}>
      {current === id && (
        <motion.span className="nav-active-pill" layoutId="sidebar-active" transition={iosSpring} aria-hidden="true" />
      )}
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
  { id: "analytics", label: "Orçamento", icon: "budget" },
  { id: "goals", label: "Metas", icon: "heart" },
  { id: "profile", label: "Perfil", icon: "user" },
] as const;

/** Floating Liquid Glass tab bar (phones). A glass lens slides to the active tab. */
export function MobileNav({
  page,
  navigate,
  onAdd,
}: NavigationProps & { onAdd: () => void }) {
  const render = ({ id, label, icon }: (typeof mobileLinks)[number]) => {
    const isActive = page === id;
    return (
      <button
        key={id}
        type="button"
        className="tabbar-item"
        aria-current={isActive ? "page" : undefined}
        onClick={() => navigate(id)}
      >
        {isActive && (
          <motion.span className="tabbar-lens" layoutId="tabbar-lens" transition={iosSpring} aria-hidden="true" />
        )}
        <Icon name={icon} size={22} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav className="tabbar" data-page={page} aria-label="Navegação principal">
      {render(mobileLinks[0])}
      {render(mobileLinks[1])}
      <button type="button" className="tabbar-item tabbar-add" onClick={onAdd} aria-label="Novo lançamento">
        <span className="tabbar-add-orb" aria-hidden="true">
          <Icon name="plus" size={20} />
        </span>
        <span aria-hidden="true">Novo</span>
      </button>
      {render(mobileLinks[2])}
      {render(mobileLinks[3])}
    </nav>
  );
}
