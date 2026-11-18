import { useTheme } from "../theme/ThemeProvider";
import { Icon } from "./common";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      className="top-pill-btn theme-toggle"
      role="switch"
      aria-label="Modo escuro"
      aria-checked={dark}
      title={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      data-scheme={resolvedTheme}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        setTheme(dark ? "light" : "dark", { x: box.left + box.width / 2, y: box.top + box.height / 2 });
      }}
    >
      <span className="theme-toggle-sun" aria-hidden="true"><Icon name="sun" size={18} /></span>
      <span className="theme-toggle-moon" aria-hidden="true"><Icon name="moon" size={18} /></span>
    </button>
  );
}
