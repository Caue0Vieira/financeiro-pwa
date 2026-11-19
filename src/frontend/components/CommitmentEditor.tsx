import { useState, type FormEvent } from "react";
import type { Action, Card } from "../../contracts";
import { todayInSaoPaulo } from "../../date";
import { SUBSCRIPTION_CATEGORY } from "../commitments";
import { money, monthName } from "../format";
import { findMerchant } from "../merchants";
import type { CommitmentMode } from "../types";
import { Icon, type IconName } from "./common";
import { Field } from "./Field";
import MoneyField from "./MoneyField";
import { Overlay } from "./Overlay";
import { PayWithField } from "./PayWithField";
import { Select } from "./Select";

const modes: { id: CommitmentMode; label: string; hint: string; example: string; icon: IconName; save: string }[] = [
  { id: "monthly", label: "Conta fixa", hint: "Todo mês", example: "Ex.: Aluguel", icon: "house", save: "Salvar conta fixa" },
  { id: "subscription", label: "Assinatura", hint: "Serviço mensal", example: "Ex.: Spotify", icon: "repeat", save: "Salvar assinatura" },
  { id: "installments", label: "Parcelada", hint: "Dividida no cartão", example: "Ex.: Notebook", icon: "card", save: "Salvar compra parcelada" },
  { id: "once", label: "Conta avulsa", hint: "Vence uma vez", example: "Ex.: IPVA", icon: "receipt", save: "Salvar conta" },
];

export default function CommitmentEditor({
  cards,
  month,
  initialMode = "monthly",
  busy,
  error,
  close,
  openCards,
  save,
}: {
  cards: Card[];
  month: string;
  initialMode?: CommitmentMode;
  busy: boolean;
  error: string;
  close: () => void;
  openCards: () => void;
  save: (action: Action, month: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<CommitmentMode>(initialMode);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>();
  const [count, setCount] = useState("");
  const [startMonth, setStartMonth] = useState(month);
  const [modeError, setModeError] = useState("");
  const today = todayInSaoPaulo();
  const needsCard = mode === "installments" && cards.length === 0;
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;
  const recurring = mode === "monthly" || mode === "subscription";
  const installmentCount = Number(count);
  const perInstallment =
    mode === "installments" && amount && installmentCount > 1 ? Math.floor(amount / installmentCount) : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const name = description.trim();
    if (busy || needsCard || !name || amount === undefined || amount <= 0) return;

    const category = read("category") || findMerchant(name)?.category;
    if (mode === "once") {
      const date = read("date");
      void save({
        type: "saveEntry",
        entry: { date, description: name, amount: -amount, kind: "expense", status: "planned", category: category || "Contas" },
      }, date.slice(0, 7));
    } else if (recurring) {
      const startMonth = read("startMonth") || month;
      const endMonth = read("endMonth") || undefined;
      if (endMonth && endMonth < startMonth) {
        setModeError("O mês final deve ser igual ou posterior ao mês inicial.");
        return;
      }
      const kind = mode === "monthly" && read("kind") === "income" ? "income" : "expense";
      const cardId = (kind === "expense" && read("payWith")) || undefined;
      void save({
        type: "saveRecurrence",
        recurrence: {
          description: name,
          amount: kind === "expense" ? -amount : amount,
          kind,
          category:
            mode === "subscription"
              ? SUBSCRIPTION_CATEGORY
              : category || (kind === "expense" ? "Contas" : "Receitas"),
          day: Number(read("day")),
          startMonth,
          endMonth,
          cardId,
        },
      }, startMonth);
    } else {
      const firstMonth = read("firstMonth");
      if (amount < installmentCount) {
        setModeError("O valor precisa cobrir pelo menos R$ 0,01 por parcela.");
        return;
      }
      void save({
        type: "addInstallments",
        description: name,
        cardId: read("cardId"),
        category: category || "Compras",
        total: amount,
        count: installmentCount,
        firstMonth,
      }, firstMonth);
    }
  }

  const displayedError = modeError || error;
  const current = modes.find(({ id }) => id === mode)!;

  return (
    <Overlay title="Novo compromisso" onClose={close}>
      <form onSubmit={submit} onChange={() => setModeError("")}>
        <div className="form-grid commitment-form">
          <div className="commitment-types full" role="radiogroup" aria-label="Tipo de compromisso">
            {modes.map(({ id, label, hint, icon }) => (
              <button
                type="button"
                role="radio"
                key={id}
                aria-checked={mode === id}
                disabled={busy}
                onClick={() => { setModeError(""); setMode(id); }}
              >
                <Icon name={icon} size={18} />
                <strong>{label}</strong>
                <span>{hint}</span>
              </button>
            ))}
          </div>
          {needsCard ? (
            <p className="form-hint full">Cadastre um cartão para lançar uma compra parcelada.</p>
          ) : (
            <>
              <Field
                label={mode === "subscription" ? "Serviço" : "Descrição"}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={current.example}
                pattern={".*\\S.*"}
                required
                full
              />
              <MoneyField
                label={mode === "installments" ? "Valor total da compra" : mode === "once" ? "Valor" : "Valor por mês"}
                name="amount"
                value={amount}
                onValueChange={setAmount}
                required
              />
              {mode === "once" && (
                <Field label="Vencimento" name="date" type="date" defaultValue={defaultDate} required />
              )}
              {recurring && (
                <>
                  <Field
                    label={mode === "subscription" ? "Dia da cobrança" : "Dia do vencimento"}
                    name="day"
                    type="number"
                    min={1}
                    max={31}
                    placeholder="Ex.: 10"
                    required
                  />
                  {cards.length > 0 && <PayWithField cards={cards} />}
                  <details className="form-details full">
                    <summary>Começa em {monthName(startMonth || month)}</summary>
                    <div className="form-grid">
                      <Field
                        label="Mês inicial"
                        name="startMonth"
                        type="month"
                        value={startMonth}
                        onChange={(event) => setStartMonth(event.target.value)}
                      />
                      <Field label="Mês final (opcional)" name="endMonth" type="month" />
                      {mode === "monthly" && (
                        <>
                          <Field label="Tipo">
                            <Select name="kind" defaultValue="expense">
                              <option value="expense">Conta a pagar</option>
                              <option value="income">Receita</option>
                            </Select>
                          </Field>
                          <Field label="Categoria" name="category" placeholder="Opcional" />
                        </>
                      )}
                    </div>
                  </details>
                </>
              )}
              {mode === "installments" && (
                <>
                  <Field
                    label="Parcelas"
                    name="count"
                    type="number"
                    min={2}
                    max={120}
                    placeholder="Ex.: 10"
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                    required
                  />
                  {perInstallment !== undefined && (
                    <p className="form-hint full commitment-preview" aria-live="polite">
                      {installmentCount} parcelas de cerca de {money(perInstallment)} por mês
                    </p>
                  )}
                  <Field label="Cartão">
                    <Select name="cardId" defaultValue={cards.length === 1 ? cards[0].id : ""} required>
                      <option value="">Selecione</option>
                      {cards.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Primeira fatura" name="firstMonth" type="month" defaultValue={month} required />
                  <details className="form-details full">
                    <summary>Categoria (opcional)</summary>
                    <Field label="Categoria" name="category" placeholder="Ex.: Compras" full />
                  </details>
                </>
              )}
            </>
          )}
        </div>
        {displayedError && <p className="inline-error" role="alert">{displayedError}</p>}
        <div className="form-actions">
          {needsCard ? (
            <button type="button" className="button" onClick={openCards}>Abrir Cartões</button>
          ) : (
            <button className="button" disabled={busy}>{busy ? "Salvando…" : current.save}</button>
          )}
          <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancelar</button>
        </div>
      </form>
    </Overlay>
  );
}

