import { useId, useRef, useState, type ReactNode } from "react";
import type { Dashboard, FinanceService } from "../../contracts";
import { HeaderMenu, PageHeading } from "../components/common";
import type { OpenEditor } from "../types";
import Analytics from "./Analytics";
import Budget from "./Budget";

const tabs = [
  { id: "budget", label: "Orçamento" },
  { id: "analytics", label: "Análise" },
] as const;
type Tab = (typeof tabs)[number]["id"];

export default function Planning({
  data,
  monthControl,
  analyze,
  openEditor,
  onViewTransactions,
}: {
  data: Dashboard;
  monthControl: ReactNode;
  analyze: FinanceService["analysis"];
  openEditor: OpenEditor;
  onViewTransactions: () => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState<Tab>("budget");
  const [openedAnalytics, setOpenedAnalytics] = useState(false);
  const tabButtons = useRef<Record<Tab, HTMLButtonElement | null>>({ budget: null, analytics: null });
  const start = useRef<{ pointer: number; x: number; y: number }>(undefined);
  const swiped = useRef(false);

  function selectTab(tab: Tab, focus = false) {
    const button = tabButtons.current[tab];
    if (focus) button?.focus({ preventScroll: true });
    if (selected === tab) return;
    if (tab === "analytics") setOpenedAnalytics(true);
    setSelected(tab);
    if (button && button.getBoundingClientRect().top < 0) {
      button.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }

  const tabId = (tab: Tab) => `${id}-tab-${tab}`;
  const panelId = (tab: Tab) => `${id}-panel-${tab}`;
  return (
    <>
      <PageHeading
        title="Análise e Orçamento"
        action={
          <HeaderMenu icon="calendar" label="Selecionar mês">
            {monthControl}
          </HeaderMenu>
        }
      />
      <div
        className="planning-tabs"
        role="tablist"
        aria-label="Orçamento e análise"
        onKeyDown={(event) => {
          let next: Tab;
          switch (event.key) {
            case "ArrowLeft":
            case "ArrowRight":
              next = selected === "budget" ? "analytics" : "budget";
              break;
            case "Home":
              next = "budget";
              break;
            case "End":
              next = "analytics";
              break;
            default:
              return;
          }
          event.preventDefault();
          selectTab(next, true);
        }}
      >
        {tabs.map(({ id: tab, label }) => (
          <button
            key={tab}
            ref={(element) => { tabButtons.current[tab] = element; }}
            type="button"
            role="tab"
            id={tabId(tab)}
            aria-selected={selected === tab}
            aria-controls={panelId(tab)}
            tabIndex={selected === tab ? 0 : -1}
            onClick={() => selectTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="planning-panels"
        data-switched={openedAnalytics}
        onPointerDown={(event) => {
          swiped.current = false;
          if (!event.isPrimary || event.pointerType === "mouse") {
            start.current = undefined;
            return;
          }
          start.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => { start.current = undefined; }}
        onPointerUp={(event) => {
          const origin = start.current;
          start.current = undefined;
          if (origin?.pointer !== event.pointerId) return;
          const dx = event.clientX - origin.x;
          const dy = event.clientY - origin.y;
          if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
          swiped.current = true;
          selectTab(dx < 0 ? "analytics" : "budget", event.currentTarget.contains(document.activeElement));
        }}
        onClickCapture={(event) => {
          if (!swiped.current || event.detail === 0) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {tabs.map(({ id: tab }) => (
          <div
            key={tab}
            className="planning-panel"
            data-tab={tab}
            role="tabpanel"
            id={panelId(tab)}
            aria-labelledby={tabId(tab)}
            tabIndex={0}
            hidden={selected !== tab}
          >
            {tab === "budget" ? (
              <Budget data={data} openEditor={openEditor} />
            ) : openedAnalytics && (
              <Analytics
                month={data.month}
                revision={data}
                analyze={analyze}
                onViewTransactions={onViewTransactions}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
