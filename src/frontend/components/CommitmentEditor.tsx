import { useState, type FormEvent } from "react";
import type { Action, Card } from "../../contracts";
import { todayInSaoPaulo } from "../../date";
import { monthName } from "../format";
import { findMerchant } from "../merchants";
import { Field } from "./Field";
import MoneyField from "./MoneyField";
import { Overlay } from "./Overlay";
import { Select } from "./Select";

const modes = [
  { id: "once", label: "Conta única", example: "Ex.: Conta de luz" },
  { id: "monthly", label: "Mensal", example: "Ex.: Internet" },
  { id: "installments", label: "Parcelada", example: "Ex.: Notebook" },
] as const;

export default function CommitmentEditor({
  cards,
  month,
  busy,
  error,
  close,
  openCards,
  save,
}: {
  cards: Card[];
  month: string;
  busy: boolean;
  error: string;
  close: () => void;
  openCards: () => void;
  save: (action: Action, month: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<(typeof modes)[number]["id"]>("once");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>();
  const [startMonth, setStartMonth] = useState(month);
  const [modeError, setModeError] = useState("");
  const today = todayInSaoPaulo();
  const needsCard = mode === "installments" && cards.length === 0;
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;

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
    } else if (mode === "monthly") {
      const startMonth = read("startMonth") || month;
      const endMonth = read("endMonth") || undefined;
      if (endMonth && endMonth < startMonth) {
        setModeError("O mês final deve ser igual ou posterior ao mês inicial.");
        return;
      }
      const kind = read("kind") === "income" ? "income" : "expense";
      void save({
        type: "saveRecurrence",
        recurrence: {
          description: name,
          amount: kind === "expense" ? -amount : amount,
          kind,
          category: category || (kind === "expense" ? "Contas" : "Receitas"),
          day: Number(read("day")),
          startMonth,
          endMonth,
        },
      }, startMonth);
    } else {
      const firstMonth = read("firstMonth");
      const installments = Number(read("count"));
      if (amount < installments) {
        setModeError("O valor precisa cobrir pelo menos R$ 0,01 por parcela.");
        return;
      }
      void save({
        type: "addInstallments",
        description: name,
        cardId: read("cardId"),
        category: category || "Compras",
        total: amount,
        count: installments,
        firstMonth,
      }, firstMonth);
    }
  }

  const displayedError = modeError || error;

  return (
    <Overlay title="Novo compromisso" onClose={close}>
      <form onSubmit={submit} onChange={() => setModeError("")}>
        <div className="form-grid commitment-form">
          <div className="segmented commitment-options full" role="group" aria-label="Tipo de compromisso">
            {modes.map(({ id, label }) => (
              <button
                type="button"
                key={id}
                aria-pressed={mode === id}
                disabled={busy}
                onClick={() => { setModeError(""); setMode(id); }}
              >
                {label}
              </button>
            ))}
          </div>
          {needsCard ? (
            <p className="form-hint full">Cadastre um cartão para lançar uma compra parcelada.</p>
          ) : (
            <>
              <Field
                label="Descrição"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={modes.find(({ id }) => id === mode)?.example}
                pattern={".*\\S.*"}
                required
                full
              />
              <MoneyField
                label={mode === "installments" ? "Valor total (R$)" : "Valor (R$)"}
                name="amount"
                value={amount}
                onValueChange={setAmount}
                required
              />
              {mode === "once" && (
                <Field label="Vencimento" name="date" type="date" defaultValue={defaultDate} required />
              )}
              {mode === "monthly" && (
                <>
                  <Field label="Dia do mês" name="day" type="number" min={1} max={31} placeholder="Ex.: 10" required />
                  <details className="form-details full">
                    <summary>Início em {monthName(startMonth || month)}</summary>
                    <div className="form-grid">
                      <Field
                        label="Mês inicial"
                        name="startMonth"
                        type="month"
                        value={startMonth}
                        onChange={(event) => setStartMonth(event.target.value)}
                      />
                      <Field label="Mês final (opcional)" name="endMonth" type="month" />
                      <Field label="Tipo de lançamento">
                        <Select name="kind" defaultValue="expense">
                          <option value="expense">Despesa</option>
                          <option value="income">Receita</option>
                        </Select>
                      </Field>
                      <Field label="Categoria" name="category" placeholder="Opcional" />
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
                    min={1}
                    max={120}
                    placeholder="Ex.: 3"
                    required
                  />
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
            <button className="button" disabled={busy}>{busy ? "Salvando…" : "Salvar compromisso"}</button>
          )}
          <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancelar</button>
        </div>
      </form>
    </Overlay>
  );
}
