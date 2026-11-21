import { useEffect, useRef, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import type { Action, Dashboard as DashboardData } from "../contracts";
import CardPicker from "./components/CardPicker";
import CommitmentEditor from "./components/CommitmentEditor";
import Editor from "./components/Editor";
import InvoiceAlerts, { useInvoiceAlerts } from "./components/InvoiceAlerts";
import { Avatar, BackNavigation, Icon, MonthControl, PageHeading } from "./components/common";
import { MobileNav, Sidebar } from "./components/Navigation";
import OpenFinance from "./pages/OpenFinance";
import Activity, { type ActivityFilter } from "./pages/Activity";
import Assistant, { AssistantBubble } from "./pages/Assistant";
import Dashboard from "./pages/Dashboard";
import Cards from "./pages/Cards";
import Commitments, { CommitmentDetail } from "./pages/Commitments";
import Goals from "./pages/Goals";
import Investments from "./pages/Investments";
import More from "./pages/More";
import Planning from "./pages/Planning";
import Profile from "./pages/Profile";
import { ThemeToggle } from "./components/ThemeToggle";
import type { CommitmentView, EditModal, FinanceCommands, Page } from "./types";
import { isSubscription } from "./commitments";
import "./styles/app.css";
import "./styles/screens.css";
import "./styles/dashboard.css";
import "./styles/reference.css";
import "./styles/liquid-glass.css";
import "./styles/tabbar.css";
import { useEntrance, useSpotlight } from "./motion/liquid";
import { usePageGestures } from "./motion/gestures";

type Props = {
  data: DashboardData;
  /** Month the user picked; can be ahead of data.month while it loads. */
  selectedMonth: string;
  onMonth: (month: string) => void;
  commands: FinanceCommands;
  importView: ReactNode;
  preview: boolean;
  email: string;
  onSignOut: () => Promise<void>;
};

type Notice = { message: string; kind: "success" | "error"; exiting?: boolean };
const toastVisibleMs = 1500;
/** Pages of the phone tab bar, in order, for swiping between them. */
const swipeTabs: Page[] = ["home", "analytics", "goals", "profile"];
const toastExitMs = 180;
/** Screens a link can open (`/?abrir=commitments`): push notifications and the manifest shortcuts. */
const linkPages: Page[] = ["home", "activity", "analytics", "commitments", "cards", "goals", "investments", "assistant", "profile"];
export function pageFromLink(href: string): Page | undefined {
  try {
    const page = new URL(href, window.location.origin).searchParams.get("abrir") as Page | null;
    return page && linkPages.includes(page) ? page : undefined;
  } catch {
    return undefined;
  }
}

export default function FinanceApp({
  data,
  selectedMonth,
  onMonth,
  commands,
  importView,
  preview,
  email,
  onSignOut,
}: Props) {
  const [page, setPage] = useState<Page>(() => pageFromLink(window.location.href) ?? "home");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activityMonth, setActivityMonth] = useState(data.month);
  const [commitmentView, setCommitmentView] = useState<CommitmentView>("fixed");
  /** Tab Orçamento e Análise opens on (the summary card goes straight to Análise). */
  const [planningTab, setPlanningTab] = useState<"budget" | "analytics">("budget");
  const trail = useRef<Page[]>([]);
  const [modal, setModal] = useState<EditModal>();
  const [notice, setNotice] = useState<Notice>();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [editorError, setEditorError] = useState("");
  const [busy, setBusy] = useState(false);
  const main = useRef<HTMLElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const month = data.month;
  const invoiceAlerts = useInvoiceAlerts(data, commands.dashboard);
  useSpotlight(shell);
  useEntrance(shell);
  const pullIndicator = useRef<HTMLDivElement>(null);
  const swipeIndicator = useRef<HTMLDivElement>(null);
  // Swiping sideways walks the tab bar on its pages and goes back everywhere else.
  const tabIndex = swipeTabs.indexOf(page);
  const swipeTarget = (direction: 1 | -1): Page | "back" | undefined =>
    tabIndex >= 0 ? swipeTabs[tabIndex + direction] : direction === -1 ? "back" : undefined;
  usePageGestures({
    pull: pullIndicator,
    swipe: swipeIndicator,
    refresh: commands.refresh,
    canSwipe: (direction) => !modal && Boolean(swipeTarget(direction)),
    onSwipe: (direction) => {
      const target = swipeTarget(direction);
      if (!target) return false;
      if (target === "back") goBack();
      else navigate(target);
      return true;
    },
  });

  // A link opened the app on a screen: drop the parameter so a reload starts at home.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);

  // A tapped notification while the app is open: the service worker asks for the screen.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const target = event.data?.type === "open" && typeof event.data.url === "string" ? pageFromLink(event.data.url) : undefined;
      if (target) navigateRef.current(target);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, []);

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
    if (next === "analytics") setPlanningTab("budget");
    else trail.current.push(page);
    moveFocus.current = true;
    setNotice(undefined);
    if (next === "activity") {
      setActivityFilter(filter);
      setActivityMonth(month);
    }
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
      : action.type === "addInstallments" ? "Compra parcelada salva."
      : action.type === "saveRecurrence" && !action.recurrence.id && isSubscription(action.recurrence.category) ? "Assinatura salva."
      : savedMonth ? "Conta salva." : "Alterações salvas.";
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
  const monthControl = <MonthControl month={selectedMonth} onMonth={onMonth} />;
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
        onDismissSummary={(summaryMonth) => {
          void (async () => {
            try {
              await commands.summaries?.dismiss(summaryMonth);
              await commands.refresh();
            } catch {
              showNotice("Não foi possível dispensar o resumo. Tente de novo.", "error");
            }
          })();
        }}
        onSummaryHistory={() => {
          navigate("analytics");
          setPlanningTab("analytics");
        }}
      />
    ),
    activity: (
      <Activity
        key={activityFilter}
        month={activityMonth}
        revision={data}
        history={commands.history}
        monthControl={<MonthControl month={activityMonth} onMonth={setActivityMonth} />}
        openEditor={openEditor}
        initialFilter={activityFilter}
        onImport={() => navigate("import")}
      />
    ),
    analytics: (
      <Planning
        key={planningTab}
        initialTab={planningTab}
        summaries={commands.summaries}
        data={data}
        monthControl={monthControl}
        analyze={commands.analysis}
        openEditor={openEditor}
        onViewTransactions={() => navigate("activity", "expense")}
      />
    ),
    cards: (
      <Cards cards={activeCards} accounts={data.accounts} invoices={data.invoices} month={data.month} openEditor={openEditor} />
    ),
    connections: (
      <OpenFinance
        connections={commands.bankConnections}
        onImported={commands.refresh}
        showNotice={showNotice}
        navigate={navigate}
      />
    ),
    commitments: (
      <Commitments
        data={data}
        monthControl={monthControl}
        setModal={openEditor}
        openView={(view) => {
          setCommitmentView(view);
          navigate("commitment-detail");
        }}
      />
    ),
    "commitment-detail": (
      <CommitmentDetail view={commitmentView} data={data} monthControl={monthControl} setModal={openEditor} />
    ),
    investments: <Investments data={data} setModal={openEditor} />,
    goals: <Goals data={data} openEditor={openEditor} />,
    assistant: <Assistant data={data} commands={commands} showNotice={showNotice} />,
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
    more: <More navigate={navigate} />,
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell" data-page={page} ref={shell}>
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
              {page !== "commitments" && page !== "commitment-detail" && (
                <button className="button desktop-add" onClick={add}>
                  <Icon name="plus" size={18} /> Novo lançamento
                </button>
              )}
              <div className="top-pill" role="group" aria-label="Tema e notificações">
                <ThemeToggle />
                <button
                  type="button"
                  className="top-pill-btn top-bell"
                  aria-label={
                    invoiceAlerts.length
                      ? `Notificações (${invoiceAlerts.length} faturas a pagar)`
                      : "Notificações e contas a pagar"
                  }
                  onClick={() => navigate("commitments")}
                >
                  <Icon name="bell" size={18} />
                  {invoiceAlerts.length > 0 && <span className="top-bell-dot" aria-hidden="true" />}
                </button>
              </div>
              <button className="top-user-pill" onClick={() => navigate("profile")} aria-label="Abrir perfil">
                <Avatar profile={data.profile} />
                <span className="top-user-meta">
                  <strong>{data.profile.name || "Sua conta"}</strong>
                  <small>{email || (preview ? "Demonstração" : "Minha conta")}</small>
                </span>
                <Icon name="chevronDown" size={16} />
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
        <AssistantBubble page={page} onOpen={() => navigate("assistant")} />
        <MobileNav page={page} navigate={navigate} onAdd={add} />
        <div className="pull-indicator" ref={pullIndicator} aria-hidden="true">
          <Icon name="refresh" size={20} />
        </div>
        <div className="swipe-indicator" ref={swipeIndicator} aria-hidden="true">
          <Icon name="chevronLeft" size={22} />
        </div>
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
            initialMode={modal.mode}
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
            month={page === "activity" ? activityMonth : month}
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
    </MotionConfig>
  );
}
