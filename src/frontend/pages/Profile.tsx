import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Dashboard } from "../../contracts";
import { Avatar, Icon, PageHeading, type IconName } from "../components/common";
import { Field } from "../components/Field";
import { ApiTiming } from "../components/ApiTiming";
import { ProfilePhotoDialog } from "../components/ProfilePhotoDialog";
import { ThemeToggle } from "../components/ThemeToggle";
import { AppIconPicker } from "../components/AppIconPicker";
import { OpenFinanceGuide } from "../components/OpenFinanceGuide";
import { PushSettings } from "../components/PushSettings";
import type { FinanceCommands, Page } from "../types";
import { dateLabel } from "../format";

function ProfileSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <details className="profile-section">
      <summary>
        <Icon name={icon} />
        <strong>{title}</strong>
        <Icon name="chevronRight" size={16} />
      </summary>
      <div className="profile-section-body">{children}</div>
    </details>
  );
}

export default function Profile({
  data,
  invoiceReminders,
  month,
  commands,
  preview,
  email,
  onSignOut,
  showNotice,
  navigate,
}: {
  data: Dashboard;
  invoiceReminders: ReactNode;
  month: string;
  commands: FinanceCommands;
  preview: boolean;
  email: string;
  onSignOut: () => Promise<void>;
  showNotice: (message: string, kind?: "success" | "error") => void;
  navigate: (page: Page) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const photoButton = useRef<HTMLButtonElement>(null);
  const used = data.budget > 0 ? Math.round((Math.max(0, data.expenses) / data.budget) * 100) : undefined;
  return (
    <>
      <PageHeading title="Perfil" />
      <div className="profile-layout">
        <div className="profile-side">
          <div className="panel profile-hero-card">
            <div className="profile-hero">
              <button
                ref={photoButton}
                type="button"
                className="profile-avatar-button"
                aria-label="Alterar foto de perfil"
                aria-haspopup="dialog"
                disabled={busy}
                onClick={() => setPhotoOpen(true)}
              >
                <Avatar profile={data.profile} />
                <span className="profile-avatar-camera"><Icon name="camera" size={13} /></span>
              </button>
              <div className="profile-identity">
                <h2>{data.profile.name || "Sua conta"}</h2>
                <p>{preview ? "Modo demonstração" : email}</p>
              </div>
              <div className="top-pill profile-theme-pill">
                <ThemeToggle />
              </div>
            </div>
          </div>
          <button className="feature-card profile-budget" onClick={() => navigate("analytics")}>
            <span>
              <span>Planejamento do mês</span>
              <strong>
                {used === undefined
                  ? "Defina seu orçamento"
                  : used > 100
                    ? "Limite ultrapassado"
                    : "Dentro do orçamento"}
              </strong>
              <small>
                {used === undefined
                  ? "Acompanhe quanto você ainda pode gastar."
                  : "Veja os gastos por categoria."}
              </small>
            </span>
            {used === undefined ? (
              <Icon name="arrowUp" />
            ) : (
              <span
                className="profile-budget-ring"
                style={{ "--used": Math.min(used, 100) + "%" } as CSSProperties}
              >
                <strong>{used}%</strong>
              </span>
            )}
          </button>
          <div className="profile-shortcuts">
            <button className="profile-shortcut-tile" onClick={() => navigate("cards")}>
              <Icon name="card" size={19} />
              <span>Cartões</span>
              <Icon name="chevronRight" size={15} />
            </button>
            <button className="profile-shortcut-tile" onClick={() => navigate("import")}>
              <Icon name="upload" size={19} />
              <span>Importar</span>
              <Icon name="chevronRight" size={15} />
            </button>
          </div>
        </div>
        <div className="profile-main">
          <div className="panel profile-menu screen-list">
            <ProfileSection title="Dados pessoais" icon="user">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  try {
                    await commands.saveProfile(String(f.get("name")));
                    await commands.refresh();
                    showNotice("Perfil atualizado.");
                  } catch (err) {
                    showNotice(err instanceof Error ? err.message : "Não foi possível atualizar o perfil.", "error");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="form-grid">
                  <Field label="Nome" name="name" defaultValue={data.profile.name} required full />
                </div>
                <div className="form-actions">
                  <button className="button" disabled={busy}>
                    Salvar perfil
                  </button>
                </div>
              </form>
            </ProfileSection>
            <ProfileSection title="Segurança e privacidade" icon="shield">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  setBusy(true);
                  try {
                    await commands.changePassword(String(f.get("current")), String(f.get("next")));
                    form.reset();
                    showNotice("Senha atualizada.");
                  } catch (err) {
                    showNotice(err instanceof Error ? err.message : "Não foi possível atualizar a senha.", "error");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="form-grid">
                  <Field
                    label="Senha atual"
                    name="current"
                    type="password"
                    autoComplete="current-password"
                    required
                    full
                  />
                  <Field
                    label="Nova senha"
                    name="next"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    full
                  />
                </div>
                <div className="form-actions">
                  <button className="button" disabled={busy}>
                    Alterar senha
                  </button>
                </div>
              </form>
            </ProfileSection>
            <ProfileSection title="Aparência" icon="palette">
              <div className="appearance-row">
                <span>
                  <strong>Tema</strong>
                  <small>Claro ou escuro, ambos em vidro líquido.</small>
                </span>
                <span className="top-pill appearance-theme">
                  <ThemeToggle />
                </span>
              </div>
              <strong className="appearance-label">Ícone do app</strong>
              <AppIconPicker onChange={(label) => showNotice(`Ícone ${label} aplicado.`)} />
            </ProfileSection>
            <ProfileSection title="Notificações" icon="bell">
              {commands.push && <PushSettings push={commands.push} preview={preview} showNotice={showNotice} />}
              {invoiceReminders}
              <p className="subtle">Próximos vencimentos neste mês</p>
              {data.upcoming.length ? (
                <ul className="profile-reminders">
                  {data.upcoming.slice(0, 3).map((entry) => (
                    <li key={entry.id}>
                      {entry.description} · {dateLabel(entry.date)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtle">Nenhum vencimento previsto.</p>
              )}
              <button className="text-button" onClick={() => navigate("commitments")}>
                Ver contas a pagar
              </button>
            </ProfileSection>
            <ProfileSection title="Ajuda e suporte" icon="help">
              <p className="subtle">
                Importe um extrato ou uma fatura e revise os lançamentos antes de confirmar.
              </p>
              <button className="text-button" onClick={() => navigate("import")}>
                Abrir importação
              </button>
              <OpenFinanceGuide onOpenConnections={() => navigate("connections")} />
              {!preview && <ApiTiming fetchDashboard={commands.dashboard} month={month} />}
            </ProfileSection>
          </div>
          <button className="button secondary profile-signout" onClick={() => void onSignOut()}>
            <Icon name="logout" size={17} /> {preview ? "Sair da demonstração" : "Sair da conta"}
          </button>
        </div>
      </div>
      {photoOpen && (
        <ProfilePhotoDialog
          profile={data.profile}
          onClose={() => {
            setPhotoOpen(false);
            requestAnimationFrame(() => photoButton.current?.focus());
          }}
          onSave={async (photo) => {
            await commands.saveProfile(data.profile.name, photo);
            await commands.refresh();
            showNotice(photo ? "Foto atualizada." : "Foto removida.");
          }}
        />
      )}
    </>
  );
}
