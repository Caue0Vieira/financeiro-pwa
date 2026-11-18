import { flushSync } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type ColorScheme = "light" | "dark";
type Theme = ColorScheme | "system";
type ThemeSettings = {
  theme: Theme;
  resolvedTheme: ColorScheme;
  setTheme: (theme: Theme, origin?: { x: number; y: number }) => void;
};

const storageKey = "finance-theme";
const systemScheme = window.matchMedia("(prefers-color-scheme: dark)");
const ThemeContext = createContext<ThemeSettings | null>(null);

function readTheme(): Theme {
  const stored = localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function subscribeToSystemTheme(onChange: () => void) {
  systemScheme.addEventListener("change", onChange);
  return () => systemScheme.removeEventListener("change", onChange);
}

function readSystemTheme(): ColorScheme {
  return systemScheme.matches ? "dark" : "light";
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Swaps the theme with a circular reveal from `origin` (or a short crossfade as fallback). */
function transitionTheme(apply: () => void, origin?: { x: number; y: number }) {
  const root = document.documentElement;
  if (reducedMotion.matches) {
    apply();
    return;
  }
  if (!document.startViewTransition) {
    root.classList.add("theme-fading");
    apply();
    window.setTimeout(() => root.classList.remove("theme-fading"), 420);
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.classList.add("theme-switching");
  const transition = document.startViewTransition(() => flushSync(apply));
  void transition.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(.32,.72,0,1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => {});
  void transition.finished.finally(() => root.classList.remove("theme-switching"));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState(readTheme);
  const setTheme = useCallback((next: Theme, origin?: { x: number; y: number }) => {
    transitionTheme(() => setThemeState(next), origin);
  }, []);
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, readSystemTheme);
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    localStorage.setItem(storageKey, theme);
  }, [theme]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    const background = getComputedStyle(root).backgroundColor;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  }, [resolvedTheme]);

  return <ThemeContext value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
  const settings = useContext(ThemeContext);
  if (!settings) throw new Error("useTheme requires ThemeProvider");
  return settings;
}
