import { useEffect, useState } from "react";
import type { DetectedSubscription, SubscriptionDetector, SubscriptionStatus } from "../../contracts";
import { subscriptionTotals } from "../../subscriptions";
import { Icon, PageHeading } from "../components/common";
import { PageSkeleton } from "../components/Skeleton";
import { dateLabel, money } from "../format";

const cadenceLabel = { monthly: "por mês", yearly: "por ano" } as const;

/** Recurring charges the app found in the history, to confirm or ignore. */
export default function Subscriptions({
  detector,
  showNotice,
}: {
  detector?: SubscriptionDetector;
  showNotice: (message: string, kind?: "success" | "error") => void;
}) {
  const [items, setItems] = useState<DetectedSubscription[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    if (!detector) return;
    let active = true;
    setFailed(false);
    detector.list()
      .then((list) => {
        if (active) setItems(list);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [detector, attempt]);

  async function decide(item: DetectedSubscription, status: SubscriptionStatus | null) {
    if (!detector) return;
    setBusy(item.key);
    try {
      await detector.decide(item.key, status);
      setItems(await detector.list());
      const outcome = {
        confirmed: "confirmada",
        ignored: "ignorada",
        cancelled: "marcada como cancelada; saiu do total",
        none: "voltou para revisão",
      }[status ?? "none"];
      showNotice(`${item.name} ${outcome}.`);
    } catch {
      showNotice(navigator.onLine ? "Não foi possível salvar. Tente de novo." : "Sem conexão. Tente quando a internet voltar.", "error");
    } finally {
      setBusy(undefined);
    }
  }

  const heading = (
    <PageHeading title="Assinaturas" description="Cobranças que se repetem todo mês ou todo ano no extrato e nas faturas." />
  );
  if (!detector) return <>{heading}<p className="empty">Indisponível nesta conta.</p></>;
  if (failed) {
    return (
      <>
        {heading}
        <div className="panel" role="alert">
          <p>{navigator.onLine ? "Não foi possível analisar as cobranças." : "Sem conexão. As assinaturas aparecem quando a internet voltar."}</p>
          <button type="button" className="text-button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button>
        </div>
      </>
    );
  }
  if (!items) return <>{heading}<PageSkeleton label="Procurando cobranças recorrentes…" rows={4} /></>;

  const totals = subscriptionTotals(items);
  const review = items.filter(({ status }) => status === "suggested");
  const confirmed = items.filter(({ status }) => status === "confirmed");
  const ignored = items.filter(({ status }) => status === "ignored");
  const cancelled = items.filter(({ status }) => status === "cancelled");
  const row = (item: DetectedSubscription) => item.status === "cancelled" ? cancelledRow(item) : (
    <li key={item.key} className="subscription-item">
      <div className="subscription-main">
        <strong>{item.name}</strong>
        <span className="subscription-amount">{money(item.amount)} <small>{cadenceLabel[item.cadence]}</small></span>
      </div>
      <div className="subscription-badges">
        {item.isNew && <span className="badge">Nova</span>}
        {item.priceChange > 0 && (
          <span className="badge warning">Subiu {money(item.priceChange)} (era {money(item.previousAmount ?? 0)})</span>
        )}
        {item.priceChange < 0 && <span className="badge">Caiu {money(-item.priceChange)}</span>}
      </div>
      <p className="subscription-meta">
        {item.cadence === "monthly" ? `${money(item.yearlyCost)} por ano` : `${money(item.monthlyCost)} por mês`}
        {" · "}última em {dateLabel(item.lastDate)} · próxima por volta de {dateLabel(item.nextDate)}
      </p>
      <div className="subscription-actions">
        {item.status !== "confirmed" && (
          <button type="button" className="button secondary" disabled={busy === item.key} onClick={() => void decide(item, "confirmed")}>
            <Icon name="check" size={16} /> É assinatura
          </button>
        )}
        {item.status !== "ignored" && (
          <button type="button" className="text-button" disabled={busy === item.key} onClick={() => void decide(item, "ignored")}>
            {item.status === "confirmed" ? "Não é assinatura" : "Ignorar"}
          </button>
        )}
        {item.status !== "ignored" && (
          <button type="button" className="text-button" disabled={busy === item.key} onClick={() => void decide(item, "cancelled")}>
            Cancelei
          </button>
        )}
        {item.status === "ignored" && (
          <button type="button" className="text-button" disabled={busy === item.key} onClick={() => void decide(item, null)}>
            Voltar a sugerir
          </button>
        )}
      </div>
    </li>
  );
  function cancelledRow(item: DetectedSubscription) {
    return (
      <li key={item.key} className="subscription-item">
        <div className="subscription-main">
          <strong>{item.name}</strong>
          <span className="subscription-amount">{money(item.amount)} <small>{cadenceLabel[item.cadence]}</small></span>
        </div>
        {item.chargedAfterCancel && (
          <div className="subscription-badges">
            <span className="badge warning">Cobrou de novo em {dateLabel(item.lastDate)}</span>
          </div>
        )}
        <p className="subscription-meta">
          {item.chargedAfterCancel
            ? "Confira com o serviço: a cobrança continuou depois que você marcou como cancelada."
            : `Última cobrança em ${dateLabel(item.lastDate)}`}
        </p>
        <div className="subscription-actions">
          <button type="button" className="text-button" disabled={busy === item.key} onClick={() => void decide(item, "confirmed")}>
            Desfazer
          </button>
        </div>
      </li>
    );
  }

  return (
    <>
      {heading}
      <section className="feature-card subscription-totals" aria-label="Custo das assinaturas">
        <div>
          <span>Por mês</span>
          <strong>{money(totals.monthly)}</strong>
        </div>
        <div>
          <span>Por ano</span>
          <strong>{money(totals.yearly)}</strong>
        </div>
        <small>Soma das confirmadas e das sugestões; ignoradas e canceladas ficam de fora.</small>
      </section>
      {items.length === 0 && (
        <p className="empty">Nenhuma cobrança recorrente encontrada nos últimos 13 meses. Elas aparecem depois da segunda cobrança.</p>
      )}
      {review.length > 0 && (
        <section className="panel" aria-labelledby="subscriptions-review">
          <h2 id="subscriptions-review">Para revisar</h2>
          <p className="subtle">O app aprende com a sua escolha e não pergunta de novo.</p>
          <ul className="subscription-list">{review.map(row)}</ul>
        </section>
      )}
      {confirmed.length > 0 && (
        <section className="panel" aria-labelledby="subscriptions-confirmed">
          <h2 id="subscriptions-confirmed">Confirmadas</h2>
          <ul className="subscription-list">{confirmed.map(row)}</ul>
        </section>
      )}
      {cancelled.length > 0 && (
        <section className="panel" aria-labelledby="subscriptions-cancelled">
          <h2 id="subscriptions-cancelled">Canceladas</h2>
          <p className="subtle">Fora do total: economia de {money(totals.savedMonthly)} por mês.</p>
          <ul className="subscription-list">{cancelled.map(row)}</ul>
        </section>
      )}
      {ignored.length > 0 && (
        <details className="panel subscription-ignored">
          <summary>Ignoradas ({ignored.length})</summary>
          <ul className="subscription-list">{ignored.map(row)}</ul>
        </details>
      )}
    </>
  );
}
