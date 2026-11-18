import {
  createContext,
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
  setTheme: (theme: Theme) => void;
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(readTheme);
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
