import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Action, Dashboard as DashboardData } from "../contracts";
import CardPicker from "./components/CardPicker";
import CommitmentEditor from "./components/CommitmentEditor";
import Editor from "./components/Editor";
import InvoiceAlerts, { useInvoiceAlerts } from "./components/InvoiceAlerts";
import { Avatar, BackNavigation, Icon, MonthControl, PageHeading } from "./components/common";
import { MobileNav, Sidebar } from "./components/Navigation";
import Activity, { type ActivityFilter } from "./pages/Activity";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import Budget from "./pages/Budget";
import Cards from "./pages/Cards";
import Commitments from "./pages/Commitments";
import Goals from "./pages/Goals";
import Investments from "./pages/Investments";
import More from "./pages/More";
import Profile from "./pages/Profile";
import type { EditModal, FinanceCommands, Page } from "./types";
import "./styles/app.css";
import "./styles/screens.css";
import "./styles/dashboard.css";
import "./styles/reference.css";

type Props = {
  data: DashboardData;
  onMonth: (month: string) => void;
  commands: FinanceCommands;
  importView: ReactNode;
  preview: boolean;
  email: string;
  onSignOut: () => Promise<void>;
};

type Notice = { message: string; kind: "success" | "error"; exiting?: boolean };
const toastVisibleMs = 1500;
const toastExitMs = 180;

export default function FinanceApp({
  data,
  onMonth,
  commands,
  importView,
  preview,
  email,
  onSignOut,
}: Props) {
  const [page, setPage] = useState<Page>("home");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const trail = useRef<Page[]>([]);
  const [modal, setModal] = useState<EditModal>();
  const [notice, setNotice] = useState<Notice>();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [editorError, setEditorError] = useState("");
  const [busy, setBusy] = useState(false);
  const main = useRef<HTMLElement>(null);
  const moveFocus = useRef(false);
  const month = data.month;
  const invoiceAlerts = useInvoiceAlerts(data, commands.dashboard);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    main.current?.querySelector("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);

  useEffect(() => {
    if (notice?.kind !== "success") return;
    const nextNotice = notice.exiting ? undefined : { ...notice, exiting: true };
    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? nextNotice : current));
    }, notice.exiting ? toastExitMs : toastVisibleMs);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function showNotice(message: string, kind: Notice["kind"] = "success") {
    setNotice({ message, kind });
  }

  function navigate(next: Page, filter: ActivityFilter = "all") {
    if (page === next) return;
    if (next === "home") trail.current = [];
    else trail.current.push(page);
    moveFocus.current = true;
    setNotice(undefined);
    if (next === "activity") setActivityFilter(filter);
    setPage(next);
  }

  function goBack() {
    moveFocus.current = true;
    setNotice(undefined);
    setPage(trail.current.pop() ?? "home");
  }

  function openEditor(next: EditModal) {
    setEditorError("");
    setModal(next);
  }

  async function mutate(action: Action, savedMonth?: string) {
    if (busy) return;
    setBusy(true);
    setEditorError("");
    try {
      await commands.mutate(action);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente.");
      setBusy(false);
      return;
    }
    setModal(undefined);
    const message = action.type === "archiveCard" ? "Cartão excluído."
      : action.type === "saveCard" && !action.card.id ? "Cartão cadastrado."
      : savedMonth ? "Compromisso salvo." : "Alterações salvas.";
    showNotice(message);
    try {
      if (savedMonth && savedMonth !== month) onMonth(savedMonth);
      else await commands.refresh();
    } catch {
      // The app shell exposes the refresh failure and retry.
    } finally {
      setBusy(false);
    }
  }

  const add = () => openEditor({ type: "entry" });
  const activeCards = data.cards.filter((card) => !card.archived);
  const monthControl = <MonthControl month={month} onMonth={onMonth} />;
  const invoiceReminders = (
    <InvoiceAlerts
      alerts={invoiceAlerts}
      data={data}
      onOpen={(invoiceMonth) => {
        if (invoiceMonth !== month) onMonth(invoiceMonth);
        navigate("commitments");
      }}
    />
  );
  const pages: Record<Page, ReactNode> = {
    home: (
      <Dashboard
        data={data}
        monthControl={monthControl}
        invoiceReminders={invoiceReminders}
        openEditor={openEditor}
        navigate={navigate}
        balanceVisible={balanceVisible}
        onToggleBalance={() => setBalanceVisible((visible) => !visible)}
      />
    ),
    activity: (
      <Activity
        key={activityFilter}
        data={data}
        history={commands.history}
        monthControl={monthControl}
        openEditor={openEditor}
        initialFilter={activityFilter}
        onImport={() => navigate("import")}
      />
    ),
    analytics: (
      <Analytics
        month={month}
        monthControl={monthControl}
        analyze={commands.analysis}
        revision={data}
        onViewTransactions={() => navigate("activity", "expense")}
      />
    ),
    budget: <Budget data={data} monthControl={monthControl} openEditor={openEditor} />,
    cards: <Cards cards={activeCards} accounts={data.accounts} openEditor={openEditor} />,
    commitments: <Commitments data={data} monthControl={monthControl} setModal={openEditor} />,
    investments: <Investments data={data} setModal={openEditor} />,
    goals: <Goals data={data} openEditor={openEditor} />,
    import: (
      <>
        <PageHeading
          title="Importar arquivos"
          description="Revise lançamentos de extratos e faturas antes de incluí-los."
        />
        {importView}
      </>
    ),
    profile: (
      <Profile
        data={data}
        invoiceReminders={invoiceReminders}
        month={month}
        commands={commands}
        preview={preview}
        email={email}
        onSignOut={onSignOut}
        showNotice={showNotice}
        navigate={navigate}
      />
    ),
    more: <More monthControl={monthControl} navigate={navigate} />,
  };

  return (
    <div className="app-shell" data-page={page}>
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>
      <Sidebar page={page} navigate={navigate} profile={data.profile} preview={preview} />
      <main className="main" id="conteudo" ref={main} tabIndex={-1}>
        <div className="topbar">
          {preview && (
            <span className="demo-label">
              <i />
              Demonstração
            </span>
          )}
          <div className="top-actions">
            <button className="button secondary top-import" onClick={() => navigate("import")}>
              <Icon name="upload" size={17} /> Importar
            </button>
            {page !== "commitments" && (
              <button className="button desktop-add" onClick={add}>
                <Icon name="plus" size={18} /> Novo lançamento
              </button>
            )}
            <button className="profile-action" onClick={() => navigate("profile")} aria-label="Abrir perfil">
              <Avatar profile={data.profile} />
            </button>
          </div>
        </div>
        <div role="status">
          {notice?.kind === "success" && (
            <div className="success-toast" data-exiting={notice.exiting}>
              <span>{notice.message}</span>
            </div>
          )}
        </div>
        {notice?.kind === "error" && (
          <div className="notice">
            <span role="alert">{notice.message}</span>
            <button className="icon-button" onClick={() => setNotice(undefined)} aria-label="Dispensar aviso">
              <Icon name="close" size={17} />
            </button>
          </div>
        )}
        <BackNavigation.Provider value={page === "home" ? null : goBack}>
          {pages[page]}
        </BackNavigation.Provider>
      </main>
      <MobileNav page={page} navigate={navigate} />
      {modal?.type === "card-picker" ? (
        <CardPicker
          accounts={data.accounts}
          busy={busy}
          error={editorError}
          close={() => { if (!busy) setModal(undefined); }}
          openEditor={openEditor}
          save={mutate}
        />
      ) : modal?.type === "commitment" ? (
        <CommitmentEditor
          cards={activeCards}
          month={month}
          busy={busy}
          error={editorError}
          close={() => { if (!busy) setModal(undefined); }}
          openCards={() => {
            setModal(undefined);
            navigate("cards");
          }}
          save={mutate}
        />
      ) : modal && (
        <Editor
          key={modal.type}
          modal={modal}
          data={data}
          month={month}
          busy={busy}
          error={editorError}
          loadHistory={commands.history}
          close={() => {
            if (!busy) setModal(undefined);
          }}
          mutate={mutate}
          changeModal={openEditor}
        />
      )}
    </div>
  );
}
