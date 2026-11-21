import { useEffect, useRef, type RefObject } from "react";

/** Finger travel before deciding between a horizontal swipe and a vertical pull. */
const lockDistance = 12;
/** Pull distance (px, after resistance) that triggers a refresh. */
const pullTrigger = 72;
/** Horizontal travel that completes a swipe on a slow drag. */
const swipeTrigger = 80;
/** Release speed (px/ms) that completes a short, quick swipe. */
const swipeSpeed = 0.45;

/** Elements that own their touches: dialogs, form fields and their own swipers. */
const ownTouches = "dialog, input, textarea, select, [contenteditable], [data-own-gestures]";
const ownHorizontal = ".planning-panels, [data-own-swipe]";

type Options = {
  /** Pull-to-refresh indicator, moved directly to keep the drag off React renders. */
  pull: RefObject<HTMLElement | null>;
  /** Side arrow shown while swiping. */
  swipe: RefObject<HTMLElement | null>;
  refresh: () => Promise<unknown>;
  /** Called with 1 for a swipe to the left (next) and -1 for a swipe to the right (back). */
  onSwipe: (direction: 1 | -1) => boolean;
  /** Whether a swipe in that direction would do anything (to show the arrow). */
  canSwipe: (direction: 1 | -1) => boolean;
};

function scrollsSideways(target: Element | null) {
  for (let node = target; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

/**
 * Touch gestures for the phone layout: pull down at the top to refresh, swipe
 * sideways to go back or switch tabs. Mouse and pen input are left alone.
 */
export function usePageGestures(options: Options) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    let start: { x: number; y: number; time: number; atTop: boolean; sideways: boolean } | undefined;
    let axis: "x" | "y" | undefined;
    let pulled = 0;
    let swiped = 0;
    let refreshing = false;

    const showPull = (distance: number, settle = false) => {
      const element = latest.current.pull.current;
      if (!element) return;
      const progress = Math.min(distance / pullTrigger, 1);
      element.style.transition = settle ? "transform .28s var(--ease-out), opacity .28s" : "none";
      element.style.opacity = String(progress);
      element.style.transform = `translate(-50%, ${Math.min(distance, pullTrigger + 16) - 56}px) rotate(${distance * 3}deg)`;
      element.dataset.ready = String(progress >= 1);
    };
    const showSwipe = (distance: number, settle = false) => {
      const element = latest.current.swipe.current;
      if (!element) return;
      const progress = Math.min(Math.abs(distance) / swipeTrigger, 1);
      const side = distance < 0 ? "right" : "left";
      element.dataset.side = side;
      element.dataset.ready = String(progress >= 1);
      element.style.transition = settle ? "transform .25s var(--ease-out), opacity .25s" : "none";
      element.style.opacity = String(progress);
      const travel = Math.min(Math.abs(distance) * 0.45, 40) - 48;
      element.style.transform = `translateX(${side === "left" ? travel : -travel}px) scale(${0.7 + progress * 0.3})`;
    };

    const onStart = (event: TouchEvent) => {
      start = undefined;
      axis = undefined;
      pulled = 0;
      swiped = 0;
      if (event.touches.length !== 1 || refreshing) return;
      const target = event.target as Element | null;
      if (target?.closest(ownTouches) || document.querySelector("dialog[open]")) return;
      const touch = event.touches[0];
      start = {
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
        atTop: window.scrollY <= 0,
        sideways: !target?.closest(ownHorizontal) && !scrollsSideways(target),
      };
    };

    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!axis) {
        if (Math.abs(dx) < lockDistance && Math.abs(dy) < lockDistance) return;
        axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
        const direction = dx < 0 ? 1 : -1;
        if (axis === "x" && (!start.sideways || !latest.current.canSwipe(direction))) return void (start = undefined);
        if (axis === "y" && (!start.atTop || dy < 0)) return void (start = undefined);
      }
      if (event.cancelable) event.preventDefault();
      if (axis === "y") {
        pulled = Math.max(0, dy) * 0.5;
        showPull(pulled);
      } else {
        swiped = dx;
        showSwipe(dx);
      }
    };

    const onEnd = async (event: TouchEvent) => {
      const began = start;
      start = undefined;
      if (!began || !axis) return;
      if (axis === "y") {
        if (pulled < pullTrigger) return showPull(0, true);
        refreshing = true;
        latest.current.pull.current?.setAttribute("data-busy", "true");
        showPull(pullTrigger, true);
        try {
          await latest.current.refresh();
        } catch {
          // The app shell shows the failure.
        } finally {
          refreshing = false;
          latest.current.pull.current?.removeAttribute("data-busy");
          showPull(0, true);
        }
        return;
      }
      const speed = Math.abs(swiped) / Math.max(event.timeStamp - began.time, 1);
      showSwipe(0, true);
      if (Math.abs(swiped) >= swipeTrigger || (Math.abs(swiped) > 30 && speed > swipeSpeed)) {
        latest.current.onSwipe(swiped < 0 ? 1 : -1);
      }
    };

    const onCancel = () => {
      start = undefined;
      if (!refreshing) showPull(0, true);
      showSwipe(0, true);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, []);
}
