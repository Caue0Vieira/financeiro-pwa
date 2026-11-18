import { useEffect, type RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** iOS-like spring: responsive, no exaggerated overshoot. */
export const iosSpring = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;

const spotlightSurfaces =
  ".sidebar, .panel, .home-balance, .invoice-alerts, .feature-card, .budget-card, .profile-budget, .glass-hero";

/**
 * visionOS-style spotlight: one delegated pointer listener writes the cursor
 * position (--mx/--my) and intensity (--spot) onto the glass surface under it.
 */
export function useSpotlight(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current;
    if (!host || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let active: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const release = () => {
      active?.style.setProperty("--spot", "0");
      active = null;
    };
    const paint = () => {
      frame = 0;
      if (!last) return;
      const target = (last.target as Element | null)?.closest<HTMLElement>(spotlightSurfaces) ?? null;
      if (target !== active) {
        release();
        active = target;
      }
      if (!active) return;
      const box = active.getBoundingClientRect();
      active.style.setProperty("--mx", `${last.clientX - box.left}px`);
      active.style.setProperty("--my", `${last.clientY - box.top}px`);
      active.style.setProperty("--spot", "1");
    };
    const onMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", release);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", release);
      release();
    };
  }, [root]);
}

/**
 * Choreographed first paint: sidebar → topbar → page content → side widgets.
 * Runs once per mount; skipped entirely when the user prefers reduced motion.
 */
export function useEntrance(root: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(root);
        const content = q(
          ".main > :not(.topbar, [role='status'], .home-layout), .home-layout > :not(.home-aside), .home-aside > *",
        );
        const tl = gsap.timeline({ defaults: { ease: "expo.out", duration: 0.9, clearProps: "transform,opacity,visibility" } });
        tl.from(q(".sidebar"), { autoAlpha: 0, x: -24 })
          .from(q(".sidebar .nav button"), { autoAlpha: 0, x: -10, stagger: 0.035, duration: 0.6, ease: "power3.out" }, "<0.12")
          .from(q(".topbar"), { autoAlpha: 0, y: -12, ease: "power3.out" }, 0.12)
          .from(content, { autoAlpha: 0, y: 18, stagger: 0.07 }, 0.2)
          .from(q(".tabbar"), { autoAlpha: 0, y: 24 }, 0.3);
      });
      return () => mm.revert();
    },
    { scope: root },
  );
}
