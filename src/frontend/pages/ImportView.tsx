import { useState } from "react";
import type { Dashboard, Entry, EntryKind, FinanceService, ImportRow } from "../../contracts";
import { Icon } from "../components/common";
import { FileField } from "../components/Field";
import { Select } from "../components/Select";
import { money } from "../format";
import {
  decodeImportFile,
  deduplicateFitIds,
  hasPossibleDuplicate,
  installmentKey,
  parseDelimited,
  parseInterStatement,
  parseInvoiceCsv,
  parseOfx,
  periodDates,
  summarizeMonths,
  type ImportedTransaction,
  type InvoiceMapping,
  type StatementImport,
} from "../../imports/parsers";
import "./import.css";
type Props = {
  data: Dashboard;
  month: string;
  loadHistoryPage: FinanceService["history"];
  confirmImport: FinanceService["confirmImport"];
  refresh: () => Promise<void>;
};
const labels: Record<EntryKind, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  card_payment: "Pagamento de fatura",
  investment: "Investimento",
  saving: "Reserva",
  refund: "Estorno",
  uncategorized: "Revisar",
};
function coverageLabel(month: string, from: string, to: string): string {
  const [year, number] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
  if (!from || !to || to < first || from > last) return `${month}: fora da cobertura informada`;
  const start = from > first ? from : first;
  const end = to < last ? to : last;
  const format = (date: string) => date.split("-").reverse().join("/");
  const partial = start !== first || end !== last ? " (mês parcial)" : "";
  return `${format(start)} a ${format(end)}${partial}`;
}
function convert(t: ImportedTransaction, invoice: boolean): ImportRow {
  const amount = invoice ? -t.amount : t.amount;
  let kind: EntryKind;
  if (invoice) kind = amount > 0 ? "refund" : "expense";
  else if (t.kind === "invoice_payment") kind = "card_payment";
  else if (t.kind === "review") kind = "uncategorized";
  else kind = t.kind;
  return {
    date: t.date,
    description: t.description,
    amount,
    kind,
    category: kind === "refund" ? "Estorno" : t.category,
    externalId: t.fitId,
    installmentNumber: invoice ? t.installmentNumber : undefined,
    installmentCount: invoice ? t.installmentCount : undefined,
  };
}
function suggest(row: ImportRow, candidates: Entry[]): Entry | undefined {
  if (row.installmentNumber === undefined || row.installmentCount === undefined) return undefined;
  const parsedName =
    installmentKey(row.description)?.name ??
    row.description.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  const matches = candidates.filter((c) => {
    const other = installmentKey(c.description);
    const name = other?.name ?? c.description.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
    return (
      c.source === "installment" &&
      c.amount === row.amount &&
      name === parsedName &&
      c.installmentNumber === row.installmentNumber &&
      c.installmentCount === row.installmentCount
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}
export default function ImportView({ data, month, loadHistoryPage, confirmImport, refresh }: Props) {
  const activeCards = data.cards.filter((card) => !card.archived);
  const [type, setType] = useState<"statement" | "invoice">("statement");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [cardId, setCardId] = useState(activeCards[0]?.id ?? "");
  const [invoiceMonth, setInvoiceMonth] = useState(month);
  const [file, setFile] = useState<File>();
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState(";");
  const [mapping, setMapping] = useState<InvoiceMapping>({ date: 0, description: 1, amount: 2 });
  const [statement, setStatement] = useState<StatementImport>();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [candidates, setCandidates] = useState<Entry[]>([]);
  const [duplicates, setDuplicates] = useState<Record<number, "keep" | "skip" | undefined>>({});
  const [duplicateIndices, setDuplicateIndices] = useState<number[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  let headers: string[] = [];
  try {
    headers = text && type === "invoice" ? (parseDelimited(text, delimiter)[0] ?? []) : [];
  } catch {
    /* preview reports parsing errors */
  }
  const reset = () => {
    setRows([]);
    setStatement(undefined);
    setCandidates([]);
    setDuplicates({});
    setDuplicateIndices([]);
    setNotice("");
    setError("");
  };
  const selectFile = async (selected?: File) => {
    reset();
    setFile(selected);
    setText("");
    if (!selected) return;
    try {
      setText(decodeImportFile(await selected.arrayBuffer(), /\.ofx$/i.test(selected.name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };
  const loadHistory = async (period: string) => {
    const all: Entry[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const page = await loadHistoryPage(period, offset, pageSize);
      all.push(...page);
      if (page.length < pageSize) return all;
    }
  };
  const preview = async () => {
    setError("");
    setNotice("");
    setRows([]);
    setDuplicates({});
    setDuplicateIndices([]);
    setBusy(true);
    try {
      if (!file || !text) throw new Error("Escolha um arquivo para continuar.");
      if (type === "statement" && !accountId) throw new Error("Cadastre e selecione uma conta.");
      if (type === "invoice" && (!cardId || !invoiceMonth))
        throw new Error("Selecione um cartão e o mês de vencimento.");
      if (type === "statement") {
        const parsed =
          /\.ofx$/i.test(file.name) || /<OFX(?:\s|>)/i.test(text)
            ? parseOfx(text)
            : parseInterStatement(text);
        const unique = deduplicateFitIds(parsed.transactions, []);
        if (!unique.length) throw new Error("O arquivo não contém lançamentos para importar.");
        const converted = unique.map((row) => convert(row, false));
        const months = [...new Set(converted.map((row) => row.date.slice(0, 7)))];
        const history = (await Promise.all(months.map(loadHistory))).flat();
        setDuplicateIndices(
          converted.flatMap((row, index) => (hasPossibleDuplicate(row, history, accountId) ? [index] : [])),
        );
        setStatement(parsed);
        setRows(converted);
        const dates = unique.map((r) => r.date).sort();
        const period = periodDates(parsed.period);
        setFrom(period?.from ?? dates[0] ?? "");
        setTo(period?.to ?? dates[dates.length - 1] ?? "");
        if (unique.length < parsed.transactions.length)
          setNotice(
            `${parsed.transactions.length - unique.length} lançamento(s) repetido(s) no arquivo foram removidos.`,
          );
      } else {
        const parsed = parseInvoiceCsv(text, mapping, delimiter);
        if (!parsed.rows.length) throw new Error("O arquivo não contém lançamentos para importar.");
        setRows(parsed.rows.map((row) => convert(row, true)));
        setStatement(undefined);
        setCandidates(
          (await loadHistory(invoiceMonth)).filter(
            (c) => c.cardId === cardId && (c.invoiceMonth ?? c.date.slice(0, 7)) === invoiceMonth,
          ),
        );
      }
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Não foi possível analisar o arquivo.");
    } finally {
      setBusy(false);
    }
  };
  const update = (index: number, patch: Partial<ImportRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const confirm = async () => {
    if (!file || !rows.length) return;
    setBusy(true);
    setError("");
    try {
      if (type === "statement" && (!from || !to || from > to))
        throw new Error("Informe um período de cobertura válido.");
      if (duplicateIndices.some((index) => !duplicates[index]))
        throw new Error("Decida se deseja manter ou ignorar cada possível duplicata.");
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const fileHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      const keptRows = rows.filter((_, index) => duplicates[index] !== "skip");
      const result = await confirmImport({
        type,
        accountId: type === "statement" ? accountId : undefined,
        cardId: type === "invoice" ? cardId : undefined,
        month: type === "invoice" ? invoiceMonth : undefined,
        fileHash,
        from: type === "statement" ? from : undefined,
        to: type === "statement" ? to : undefined,
        rows: keptRows,
      });
      await refresh();
      setRows([]);
      setNotice(
        `Importação concluída: ${result.inserted} incluído(s), ${result.linked} vinculado(s), ${result.skipped} ignorado(s).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir a importação.");
    } finally {
      setBusy(false);
    }
  };
  const totals = summarizeMonths(rows);
  if (from && to && from <= to) {
    const [startYear, startMonth] = from.split("-").map(Number);
    const [endYear, endMonth] = to.split("-").map(Number);
    const start = startYear * 12 + startMonth - 1;
    const end = endYear * 12 + endMonth - 1;
    // Bound the preview for accidental very large date ranges.
    if (end - start <= 1200)
      for (let n = start; n <= end; n++) {
        const key = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
        if (!totals.some((t) => t.month === key)) totals.push({ month: key, inflow: 0, outflow: 0 });
      }
    totals.sort((a, b) => a.month.localeCompare(b.month));
  }
  return (
    <section className="import-view" aria-labelledby="import-title">
      <div className="import-panel">
        <div className="import-source">
          <span className="tile-icon tone-mint">
            <Icon name="upload" />
          </span>
          <div>
            <h2 id="import-title">Selecione um arquivo</h2>
            <p className="subtle">A leitura é feita no seu dispositivo.</p>
          </div>
        </div>
        <div className="import-fields">
          <label>
            Tipo de arquivo
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as "statement" | "invoice");
                setFile(undefined);
                setText("");
                reset();
              }}
            >
              <option value="statement">Extrato bancário</option>
              <option value="invoice">Fatura do cartão</option>
            </Select>
          </label>
          {type === "statement" ? (
            <label>
              Conta
              <Select
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  reset();
                }}
              >
                <option value="">Selecione</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <>
              <label>
                Cartão
                <Select
                  value={cardId}
                  onChange={(e) => {
                    setCardId(e.target.value);
                    reset();
                  }}
                >
                  <option value="">Selecione</option>
                  {activeCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Mês de vencimento
                <input
                  type="month"
                  value={invoiceMonth}
                  onChange={(e) => {
                    setInvoiceMonth(e.target.value);
                    reset();
                  }}
                />
              </label>
            </>
          )}
          <FileField
            key={type}
            label="Arquivo"
            accept={type === "statement" ? ".csv,.ofx,text/csv,application/x-ofx" : ".csv,text/csv"}
            onChange={(e) => void selectFile(e.target.files?.[0])}
          />
        </div>
        <p className="import-hint">
          {type === "statement"
            ? "Extrato Inter em CSV ou arquivo OFX. PIX e transferências ficam para revisão."
            : "CSV com data, descrição e valor. Valores positivos são compras; negativos são estornos."}
        </p>
        {type === "invoice" && text && (
          <div className="import-fields">
            <label>
              Separador
              <Select
                value={delimiter}
                onChange={(e) => {
                  setDelimiter(e.target.value);
                  reset();
                }}
              >
                <option value=";">Ponto e vírgula</option>
                <option value=",">Vírgula</option>
              </Select>
            </label>
            {(["date", "description", "amount"] as const).map((key) => (
              <label key={key}>
                Coluna de {key === "date" ? "data" : key === "description" ? "descrição" : "valor"}
                <Select
                  value={mapping[key]}
                  onChange={(e) => {
                    setMapping({ ...mapping, [key]: Number(e.target.value) });
                    reset();
                  }}
                >
                  {headers.map((h, i) => (
                    <option value={i} key={i}>
                      {h || `Coluna ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
            <label>
              Coluna de parcela (opcional)
              <Select
                value={mapping.installment ?? ""}
                onChange={(e) => {
                  setMapping({
                    ...mapping,
                    installment: e.target.value === "" ? undefined : Number(e.target.value),
                  });
                  reset();
                }}
              >
                <option value="">Usar a descrição</option>
                {headers.map((header, index) => (
                  <option value={index} key={index}>
                    {header || `Coluna ${index + 1}`}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}
        <button type="button" onClick={() => void preview()} disabled={!file || busy}>
          Analisar arquivo
        </button>
      </div>
      {error && (
        <p role="alert" className="import-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {rows.length > 0 && (
        <div className="import-panel">
          <h2>Revise os lançamentos</h2>
          {statement && (
            <>
              <p>
                {statement.period
                  ? `Período informado no arquivo: ${statement.period}`
                  : "O arquivo não informa um período de cobertura."}
              </p>
              <div className="import-fields">
                <label>
                  Cobertura de
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label>
                  até
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
              <p className="import-hint">Confirme as datas de cobertura do extrato.</p>
              <ul>
                {totals.map((t) => (
                  <li key={t.month}>
                    {coverageLabel(t.month, from, to)}: entradas {money(t.inflow)} · saídas {money(t.outflow)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>{rows.length} lançamento(s) para revisar. Altere o tipo e a categoria quando necessário.</p>
          <div className="import-rows">
            {rows.map((row, i) => {
              const candidate = type === "invoice" ? suggest(row, candidates) : undefined;
              return (
                <div className="import-row" key={i}>
                  <div>
                    <strong>{row.description}</strong>
                    <small>
                      {row.date.split("-").reverse().join("/")} · {money(row.amount)}
                    </small>
                  </div>
                  <label>
                    Tipo
                    <Select
                      value={row.kind}
                      onChange={(e) => update(i, { kind: e.target.value as EntryKind })}
                    >
                      {Object.entries(labels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Categoria
                    <input value={row.category} onChange={(e) => update(i, { category: e.target.value })} />
                  </label>
                  {duplicateIndices.includes(i) && (
                    <fieldset className="import-duplicate">
                      <legend>
                        Possível duplicata: já existe lançamento com mesma conta, data, descrição e valor.
                      </legend>
                      <label>
                        <input
                          type="radio"
                          name={`duplicate-${i}`}
                          checked={duplicates[i] === "keep"}
                          onChange={() => setDuplicates((current) => ({ ...current, [i]: "keep" }))}
                        />{" "}
                        Manter este lançamento
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`duplicate-${i}`}
                          checked={duplicates[i] === "skip"}
                          onChange={() => setDuplicates((current) => ({ ...current, [i]: "skip" }))}
                        />{" "}
                        Ignorar este lançamento
                      </label>
                    </fieldset>
                  )}
                  {candidate && (
                    <label className="import-match">
                      <input
                        type="checkbox"
                        checked={row.matchId === candidate.id}
                        onChange={(e) => update(i, { matchId: e.target.checked ? candidate.id : undefined })}
                      />{" "}
                      Vincular à parcela existente: {candidate.description} ({candidate.installmentNumber}/
                      {candidate.installmentCount})
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? "Salvando…" : "Confirmar importação"}
          </button>
        </div>
      )}
    </section>
  );
}
