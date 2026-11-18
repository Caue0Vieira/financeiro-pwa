import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Moon, Sun, UserRound } from "lucide-react";
import { brandName } from "../brand";
import { BrandMark } from "../components/common";
import { useTheme } from "../theme/ThemeProvider";
import "./login.css";

export default function Login({
  onSignIn,
  onPreview,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  onPreview?: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const ThemeIcon = dark ? Sun : Moon;
  const PasswordIcon = passwordVisible ? EyeOff : Eye;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSignIn(String(form.get("email")), String(form.get("password")));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível entrar. Confira seus dados.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <button
        className="login-theme-toggle"
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      >
        <ThemeIcon size={21} strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="login-content">
        <header className="login-heading">
          <div className="login-emblem">
            <BrandMark size={132} />
          </div>
          <h1>{brandName}</h1>
          <p>Entre na sua conta</p>
        </header>
        <form className="login-form" onSubmit={signIn} aria-busy={busy}>
          <div className="login-field">
            <UserRound className="login-field-icon" size={22} strokeWidth={1.8} aria-hidden="true" />
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder=" "
              required
            />
            <label htmlFor="login-email">E-mail</label>
          </div>
          <div className="login-field">
            <LockKeyhole className="login-field-icon" size={22} strokeWidth={1.8} aria-hidden="true" />
            <input
              id="login-password"
              name="password"
              type={passwordVisible ? "text" : "password"}
              autoComplete="current-password"
              placeholder=" "
              required
            />
            <label htmlFor="login-password">Senha</label>
            <button
              className="login-password-toggle"
              type="button"
              onClick={() => setPasswordVisible((visible) => !visible)}
              aria-controls="login-password"
              aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
            >
              <PasswordIcon size={21} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="login-submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
            <span>
              <ArrowRight size={21} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
        </form>
        {onPreview && (
          <button className="login-preview" type="button" onClick={onPreview}>
            Explorar demonstração
          </button>
        )}
      </div>
    </main>
  );
}
