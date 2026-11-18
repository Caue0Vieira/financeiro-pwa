import { useEffect, useState } from "react";
import type { Dashboard, FinanceService, Invoice } from "../../contracts";
import { addDays, todayInSaoPaulo } from "../../date";
import { dateLabel, money } from "../format";
import { invoiceAlertMonths, selectInvoiceAlerts, type InvoiceAlert } from "../invoiceAlerts";
import { BankIcon } from "./BankIcon";

export function useInvoiceAlerts(data: Dashboard, loadMonth: FinanceService["dashboard"]) {
  const [today, setToday] = useState(todayInSaoPaulo);
  const [extra, setExtra] = useState<{ data: Dashboard; today: string; invoices: Invoice[] }>();

  useEffect(() => {
    const updateDay = () => setToday(todayInSaoPaulo());
    const timer = window.setInterval(updateDay, 60_000);
    document.addEventListener("visibilitychange", updateDay);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateDay);
    };
  }, []);

  useEffect(() => {
    if (!data.cards.some(({ dueDay }) => dueDay !== null)) return;
    const months = invoiceAlertMonths(today).filter((month) => month !== data.month);
    if (!months.length) return;
    let active = true;
    void Promise.allSettled(months.map(loadMonth)).then((results) => {
      if (!active) return;
      const invoices = results.flatMap((result) => result.status === "fulfilled" ? result.value.invoices : []);
      setExtra({ data, today, invoices });
    });
    return () => { active = false; };
  }, [data, loadMonth, today]);

  const extras = extra?.data === data && extra.today === today ? extra.invoices : [];
  return selectInvoiceAlerts([...data.invoices, ...extras], today);
}

export default function InvoiceAlerts({
  alerts,
  data,
  onOpen,
}: {
  alerts: InvoiceAlert[];
  data: Dashboard;
  onOpen: (month: string) => void;
}) {
  if (alerts.length === 0) return null;
  const today = todayInSaoPaulo();
  const tomorrow = addDays(today, 1);

  return (
    <section className="panel invoice-alerts" aria-label="Alertas de fatura">
      <header className="panel-head"><h2>Faturas a pagar</h2></header>
      {alerts.map(({ cardId, month, dueDate, remaining }) => {
        const card = data.cards.find(({ id }) => id === cardId);
        const bank = data.accounts.find(({ id }) => id === card?.accountId)?.name;
        const when = dueDate < today ? `Venceu em ${dateLabel(dueDate)}`
          : dueDate === today ? "Vence hoje"
          : dueDate === tomorrow ? "Vence amanhã"
          : `Vence em ${dateLabel(dueDate)}`;
        return (
          <button className="transaction card-row" key={`${cardId}:${month}`} onClick={() => onOpen(month)}>
            <BankIcon bank={bank} />
            <span className="transaction-info">
              <strong>{card?.name || bank || "Cartão"}</strong>
              <span>{when}</span>
            </span>
            <span className="transaction-amount">{money(remaining)}</span>
          </button>
        );
      })}
    </section>
  );
}
