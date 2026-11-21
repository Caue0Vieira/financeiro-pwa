import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Dashboard, FinanceService, Summaries } from "../../contracts";
import { HeaderMenu, PageHeading } from "../components/common";
import { iosSpring } from "../motion/liquid";
import type { OpenEditor } from "../types";
import Analytics from "./Analytics";
import Budget from "./Budget";

const tabs = [
  { id: "budget", label: "Orçamento" },
  { id: "analytics", label: "Análise" },
] as const;
type Tab = (typeof tabs)[number]["id"];

/** Finger travel before deciding between a horizontal swipe and a vertical scroll. */
const slop = 8;
/** Release speed (px/ms) that switches tabs even on a short swipe. */
const flick = 0.3;
/** Share of the width that switches tabs on a slow drag. */
const distance = 0.2;

type Drag = {
  pointer: number;
  x: number;
  y: number;
  locked: boolean;
  base: number;
  lastX: number;
  lastT: number;
  velocity: number;
};

export default function Planning({
  data,
  monthControl,
  analyze,
  openEditor,
  onViewTransactions,
  initialTab = "budget",
  summaries,
}: {
  initialTab?: Tab;
  summaries?: Summaries;
  data: Dashboard;
  monthControl: ReactNode;
  analyze: FinanceService["analysis"];
  openEditor: OpenEditor;
  onViewTransactions: () => void;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<Tab>(initialTab);
  const [openedAnalytics, setOpenedAnalytics] = useState(initialTab === "analytics");
  const [moving, setMoving] = useState(false);
  const tabButtons = useRef<Record<Tab, HTMLButtonElement | null>>({ budget: null, analytics: null });
  const track = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(undefined);
  const swiped = useRef(false);
  const slide = useRef<AnimationPlaybackControls>(undefined);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const x = useMotionValue(0);

  /** Distance between the two panels (panel width + gap). */
  const step = () => {
    const panels = track.current?.children;
    if (!panels || panels.length < 2) return 0;
    return (panels[1] as HTMLElement).offsetLeft - (panels[0] as HTMLElement).offsetLeft;
  };
  const offsetOf = (tab: Tab) => (tab === "budget" ? 0 : -step());

  useLayoutEffect(() => {
    x.set(offsetOf(selectedRef.current));
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (!slide.current && !drag.current?.locked) x.set(offsetOf(selectedRef.current));
    });
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => slide.current?.stop(), []);

  // Once the swipe is horizontal, keep the browser from taking the gesture over as a
  // vertical scroll (which would cancel the pointer mid-swipe). Needs a non-passive listener.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onTouchMove = (event: TouchEvent) => {
      if (drag.current?.locked && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => element.removeEventListener("touchmove", onTouchMove);
  }, []);

  function settle(tab: Tab, velocity = 0) {
    slide.current?.stop();
    const target = offsetOf(tab);
    if (reduceMotion || x.get() === target) {
      slide.current = undefined;
      x.set(target);
      setMoving(false);
      return;
    }
    setMoving(true);
    const controls = animate(x, target, {
      ...iosSpring,
      velocity,
      restDelta: 0.5,
      onComplete: () => {
        if (slide.current !== controls) return;
        slide.current = undefined;
        setMoving(false);
      },
    });
    slide.current = controls;
  }

  function selectTab(tab: Tab, focus = false, velocity = 0) {
    const button = tabButtons.current[tab];
    if (focus) button?.focus({ preventScroll: true });
    settle(tab, velocity);
    if (selected === tab) return;
    if (tab === "analytics") setOpenedAnalytics(true);
    setSelected(tab);
    if (button && button.getBoundingClientRect().top < 0) {
      button.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    drag.current = undefined;
    if (!current.locked) return;
    swiped.current = true;
    // A finger that stopped before lifting carries no flick.
    const velocity = event.timeStamp - current.lastT > 100 ? 0 : current.velocity;
    const moved = (x.get() - offsetOf(selected)) / (step() || 1);
    let next: Tab = selected;
    if (velocity < -flick || (velocity <= flick && moved < -distance)) next = "analytics";
    else if (velocity > flick || (velocity >= -flick && moved > distance)) next = "budget";
    selectTab(next, event.currentTarget.contains(document.activeElement), velocity * 1000);
  }

  const tabId = (tab: Tab) => `${id}-tab-${tab}`;
  const panelId = (tab: Tab) => `${id}-panel-${tab}`;
  return (
    <>
      <PageHeading
        title="Orçamento e Análise"
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
            {selected === tab && (
              <motion.span className="planning-tab-indicator" layoutId={`${id}-tab-indicator`} transition={iosSpring} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      <div
        ref={viewport}
        className="planning-panels"
        data-moving={moving || undefined}
        onPointerDown={(event) => {
          swiped.current = false;
          if (!event.isPrimary || event.pointerType === "mouse") {
            drag.current = undefined;
            return;
          }
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            locked: false,
            base: 0,
            lastX: event.clientX,
            lastT: event.timeStamp,
            velocity: 0,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current?.pointer !== event.pointerId) return;
          const dx = event.clientX - current.x;
          if (!current.locked) {
            const dy = event.clientY - current.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return;
            if (Math.abs(dx) < Math.abs(dy)) {
              drag.current = undefined;
              return;
            }
            current.locked = true;
            current.base = x.get() - dx;
            slide.current?.stop();
            slide.current = undefined;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // The pointer may already be gone; the drag still works without capture.
            }
            setOpenedAnalytics(true);
            setMoving(true);
          }
          const elapsed = event.timeStamp - current.lastT;
          if (elapsed > 0) {
            const instant = (event.clientX - current.lastX) / elapsed;
            current.velocity = current.velocity * 0.3 + instant * 0.7;
          }
          current.lastX = event.clientX;
          current.lastT = event.timeStamp;
          // Follows the finger; resists past the first and last tab.
          const min = -step();
          let next = current.base + dx;
          if (next > 0) next *= 0.35;
          else if (next < min) next = min + (next - min) * 0.35;
          x.set(next);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onClickCapture={(event) => {
          if (!swiped.current || event.detail === 0) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <motion.div ref={track} className="planning-track" style={{ x }}>
          {tabs.map(({ id: tab }) => (
            <div
              key={tab}
              className="planning-panel"
              data-tab={tab}
              data-active={selected === tab || undefined}
              role="tabpanel"
              id={panelId(tab)}
              aria-labelledby={tabId(tab)}
              tabIndex={selected === tab ? 0 : -1}
              inert={selected !== tab}
            >
              {tab === "budget" ? (
                <Budget data={data} openEditor={openEditor} />
              ) : openedAnalytics && (
                <Analytics
                  month={data.month}
                  revision={data}
                  analyze={analyze}
                  summaries={summaries}
                  onViewTransactions={onViewTransactions}
                />
              )}
            </div>
          ))}
        </motion.div>
      </div>
    </>
  );
}
