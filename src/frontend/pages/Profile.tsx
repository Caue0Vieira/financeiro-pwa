import { useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import type { Dashboard } from "../../contracts";
import { Avatar, Icon, PageHeading, type IconName } from "../components/common";
import { Field, FileField } from "../components/Field";
import { Select } from "../components/Select";
import { ApiTiming } from "../components/ApiTiming";
import { useTheme } from "../theme/ThemeProvider";
import type { FinanceCommands, Page } from "../types";
import { dateLabel } from "../format";

function ProfileSection({
  title,
  icon,
  children,
  detailsRef,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
  detailsRef?: Ref<HTMLDetailsElement>;
}) {
  return (
    <details className="profile-section" ref={detailsRef}>
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
  month,
  commands,
  preview,
  email,
  onSignOut,
  showNotice,
  navigate,
}: {
  data: Dashboard;
  month: string;
  commands: FinanceCommands;
  preview: boolean;
  email: string;
  onSignOut: () => Promise<void>;
  showNotice: (message: string, kind?: "success" | "error") => void;
  navigate: (page: Page) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { theme, setTheme } = useTheme();
  const settings = useRef<HTMLDetailsElement>(null);
  const openSettings = () => {
    if (!settings.current) return;
    settings.current.open = true;
    settings.current.querySelector("summary")?.focus();
  };
  const used = data.budget > 0 ? Math.round((Math.max(0, data.expenses) / data.budget) * 100) : undefined;
  return (
    <>
      <PageHeading
        title="Perfil"
        action={
          <button className="icon-button" aria-label="Abrir configurações" onClick={openSettings}>
            <Icon name="settingsGear" size={20} />
          </button>
        }
      />
      <div className="profile-hero">
        <Avatar profile={data.profile} />
        <div>
          <h2>{data.profile.name || "Sua conta"}</h2>
          <p>{preview ? "Modo demonstração" : email}</p>
        </div>
      </div>
      <button className="feature-card profile-budget" onClick={() => navigate("budget")}>
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
      <div className="panel profile-menu screen-list">
        <ProfileSection title="Dados pessoais" icon="user">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                const file = f.get("avatar") as File;
                await commands.saveProfile(String(f.get("name")), file?.size ? file : undefined);
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
              <FileField label="Foto de perfil" name="avatar" accept="image/*" full />
            </div>
            <div className="form-actions">
              <button className="button" disabled={busy}>
                Salvar perfil
              </button>
              {data.profile.avatarUrl && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await commands.saveProfile(data.profile.name, null);
                      await commands.refresh();
                      showNotice("Foto removida.");
                    } catch (e) {
                      showNotice(e instanceof Error ? e.message : "Erro ao remover foto.", "error");
                    }
                  }}
                >
                  Remover foto
                </button>
              )}
            </div>
          </form>
        </ProfileSection>
        <button className="profile-link" onClick={() => navigate("cards")}>
          <Icon name="card" />
          <strong>Cartões</strong>
          <Icon name="chevronRight" size={16} />
        </button>
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
        <ProfileSection title="Notificações" icon="bell">
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
            Ver compromissos
          </button>
        </ProfileSection>
        <ProfileSection title="Ajuda e suporte" icon="help">
          <p className="subtle">
            Importe um extrato ou uma fatura e revise os lançamentos antes de confirmar.
          </p>
          <button className="text-button" onClick={() => navigate("import")}>
            Abrir importação
          </button>
          {!preview && <ApiTiming fetchDashboard={commands.dashboard} month={month} />}
        </ProfileSection>
        <ProfileSection title="Configurações" icon="settingsGear" detailsRef={settings}>
          <Field label="Aparência">
            <Select
              value={theme}
              onChange={({ currentTarget: { value } }) => {
                if (value === "light" || value === "dark" || value === "system") setTheme(value);
              }}
            >
              <option value="system">Usar configuração do sistema</option>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
            </Select>
          </Field>
        </ProfileSection>
      </div>
      <button className="button secondary profile-signout" onClick={() => void onSignOut()}>
        <Icon name="logout" size={17} /> {preview ? "Sair da demonstração" : "Sair da conta"}
      </button>
    </>
  );
}
