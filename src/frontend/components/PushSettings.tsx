import { useEffect, useId, useRef, useState } from "react";
import type { PushNotifications, PushPreferences } from "../../contracts";
import { defaultPreferences } from "../../notices";
import { currentDevice, demoEndpoint, isAppleMobile, pushSupport, subscribe, subscriptionKeys, workerRegistration } from "../push";
import MoneyField from "./MoneyField";
import { useOnline } from "../useOnline";

type State =
  | { status: "loading" | "install" | "unsupported" | "denied" | "unavailable" | "off" }
  | { status: "on"; endpoint: string; preferences: PushPreferences };

const switches: { key: Exclude<keyof PushPreferences, "largeExpenseMin">; label: string; detail: string }[] = [
  { key: "billDue", label: "Conta vencendo amanhã", detail: "Contas fora do cartão que vencem no dia seguinte." },
  { key: "invoiceClosing", label: "Fatura fechando", detail: "Dois dias antes do fechamento de cada cartão." },
  { key: "largeExpense", label: "Gasto alto", detail: "Compras pelo Open Finance a partir do valor escolhido." },
  { key: "budget", label: "Orçamento", detail: "Quando uma categoria ou o mês chega a 80% e a 100% do limite." },
  { key: "subscriptions", label: "Assinaturas", detail: "Quando aparece uma assinatura nova ou uma fica mais cara." },
  { key: "monthlySummary", label: "Resumo mensal", detail: "No dia 1, quando o resumo do mês anterior fica pronto." },
];

/** Profile → Notificações: turns Web Push on for this device and picks the notices it gets. */
export function PushSettings({
  push,
  preview,
  showNotice,
}: {
  push: PushNotifications;
  preview: boolean;
  showNotice: (message: string, kind?: "success" | "error") => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  /** What is typed in the minimum amount; saved once it is a valid amount. */
  const [minimum, setMinimum] = useState<number>();
  const minimumId = useId();
  const saveTimer = useRef<number>(undefined);
  const apple = isAppleMobile(currentDevice());

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  useEffect(() => {
    let active = true;
    const settle = (next: State) => {
      if (active) setState(next);
    };
    (async () => {
      const support = pushSupport(currentDevice());
      if (support !== "supported") return settle({ status: support });
      if (Notification.permission === "denied") return settle({ status: "denied" });
      if (preview) {
        const preferences = await push.preferences(demoEndpoint);
        return settle(preferences && Notification.permission === "granted"
          ? { status: "on", endpoint: demoEndpoint, preferences }
          : { status: "off" });
      }
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return settle({ status: (await push.publicKey()) ? "off" : "unavailable" });
      const preferences = await push.preferences(subscription.endpoint);
      if (preferences) return settle({ status: "on", endpoint: subscription.endpoint, preferences });
      // Subscribed in the browser but not saved (e.g. another account): save it again.
      await push.save(subscriptionKeys(subscription), defaultPreferences);
      settle({ status: "on", endpoint: subscription.endpoint, preferences: defaultPreferences });
    })().catch(() => settle({ status: navigator.onLine ? "off" : "unavailable" }));
    return () => {
      active = false;
    };
  }, [push, preview]);

  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showNotice(error instanceof Error && error.message ? error.message : failure, "error");
    } finally {
      setBusy(false);
    }
  }

  const activate = () => run(async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState({ status: permission === "denied" ? "denied" : "off" });
      return;
    }
    if (preview) {
      await push.save({ endpoint: demoEndpoint, p256dh: "", auth: "" }, defaultPreferences);
      setState({ status: "on", endpoint: demoEndpoint, preferences: defaultPreferences });
      showNotice("Notificações ativadas neste aparelho.");
      return;
    }
    const publicKey = await push.publicKey();
    if (!publicKey) {
      setState({ status: "unavailable" });
      return;
    }
    const subscription = await subscribe(await workerRegistration(), publicKey);
    await push.save(subscriptionKeys(subscription), defaultPreferences);
    setState({ status: "on", endpoint: subscription.endpoint, preferences: defaultPreferences });
    showNotice("Notificações ativadas neste aparelho.");
  }, "Não foi possível ativar as notificações.");

  const deactivate = () => run(async () => {
    if (state.status !== "on") return;
    if (!preview) {
      const registration = await navigator.serviceWorker.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    }
    await push.remove(state.endpoint);
    setState({ status: "off" });
    showNotice("Notificações desativadas neste aparelho.");
  }, "Não foi possível desativar as notificações.");

  function change(preferences: PushPreferences, delay = 0) {
    if (state.status !== "on") return;
    const { endpoint } = state;
    setState({ status: "on", endpoint, preferences });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        const registration = preview ? undefined : await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        await push.save(subscription ? subscriptionKeys(subscription) : { endpoint, p256dh: "", auth: "" }, preferences);
      })().catch(() => showNotice("Não foi possível salvar a preferência. Tente de novo.", "error"));
    }, delay);
  }

  if (state.status === "loading") return <p className="subtle push-settings">Verificando as notificações deste aparelho…</p>;
  return (
    <div className="push-settings">
      {state.status === "install" && (
        <p className="push-callout">
          No iPhone e no iPad, as notificações só funcionam com o Nítido instalado na tela de início. No Safari,
          toque em <strong>Compartilhar → Adicionar à Tela de Início</strong>, abra o app pelo ícone e volte aqui
          para ativar.
        </p>
      )}
      {state.status === "unsupported" && <p className="push-callout">Este navegador não recebe notificações.</p>}
      {state.status === "denied" && (
        <p className="push-callout">
          As notificações estão bloqueadas para o Nítido. Libere nas configurações do navegador
          {apple ? " (Ajustes → Notificações → Nítido)" : ""} e volte aqui.
        </p>
      )}
      {state.status === "unavailable" && (
        <p className="push-callout">
          {online
            ? "O servidor ainda não está pronto para enviar notificações. Tente mais tarde."
            : "Sem conexão. Conecte-se à internet para ativar as notificações."}
        </p>
      )}
      {state.status === "off" && (
        <>
          <p className="subtle">Receba avisos de contas, faturas, gastos altos e orçamento mesmo com o app fechado.</p>
          <button type="button" className="button" disabled={busy || !online} onClick={() => void activate()}>
            {busy ? "Ativando…" : "Ativar notificações"}
          </button>
          {!online && <p className="subtle">Conecte-se à internet para ativar.</p>}
        </>
      )}
      {state.status === "on" && (
        <>
          <fieldset className="push-switches" disabled={!online}>
            <legend>Avisos neste aparelho</legend>
            {switches.map(({ key, label, detail }) => (
              <label className="switch-row" key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={state.preferences[key]}
                  onChange={(event) => change({ ...state.preferences, [key]: event.target.checked })}
                />
              </label>
            ))}
            {state.preferences.largeExpense && (
              <div className="push-minimum">
                <MoneyField
                  label="Avisar gastos a partir de (R$)"
                  name="largeExpenseMin"
                  min={100}
                  value={minimum ?? state.preferences.largeExpenseMin}
                  aria-describedby={minimumId}
                  onValueChange={(cents) => {
                    setMinimum(cents);
                    if (cents && cents >= 100) change({ ...state.preferences, largeExpenseMin: cents }, 800);
                  }}
                />
                <small id={minimumId} className="subtle">Vale para compras que chegam pelo Open Finance.</small>
              </div>
            )}
          </fieldset>
          {!online && <p className="subtle">Sem conexão: as mudanças ficam disponíveis quando a internet voltar.</p>}
          <div className="push-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy || !online}
              onClick={() => void run(async () => {
                await push.test(state.endpoint);
                showNotice("Notificação de teste enviada.");
              }, "Não foi possível enviar o teste.")}
            >
              Enviar teste
            </button>
            <button type="button" className="text-button" disabled={busy || !online} onClick={() => void deactivate()}>
              Desativar neste aparelho
            </button>
          </div>
        </>
      )}
    </div>
  );
}
