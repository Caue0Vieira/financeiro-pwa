import { useId, useState } from "react";
import type { Dashboard, FinanceService } from "../../contracts";
import { currentMonth, dateInMonth, todayInSaoPaulo } from "../../date";
import { entriesCsv, monthPdf, saveFile } from "../exports";
import { Field } from "./Field";
import { useOnline } from "../useOnline";

/** Perfil → Exportar dados: CSV of a period and the PDF of a month. */
export function ExportPanel({
  data,
  entries,
  showNotice,
}: {
  data: Pick<Dashboard, "accounts" | "cards">;
  entries: FinanceService["entries"];
  showNotice: (message: string, kind?: "success" | "error") => void;
}) {
  const month = currentMonth();
  const [from, setFrom] = useState(`${month.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayInSaoPaulo());
  const [pdfMonth, setPdfMonth] = useState(month);
  const [busy, setBusy] = useState<"" | "csv" | "pdf">("");
  const online = useOnline();
  const hintId = useId();

  async function run(kind: "csv" | "pdf", task: () => Promise<void>) {
    setBusy(kind);
    try {
      await task();
    } catch {
      showNotice(navigator.onLine ? "Não foi possível gerar o arquivo. Tente de novo." : "Sem conexão. Tente quando a internet voltar.", "error");
    } finally {
      setBusy("");
    }
  }

  const csv = () => run("csv", async () => {
    const list = await entries(from, to);
    await saveFile(entriesCsv(list, data), `lancamentos-${from}-a-${to}.csv`, "text/csv;charset=utf-8");
    showNotice(`${list.length} lançamento(s) exportado(s).`);
  });
  const pdf = () => run("pdf", async () => {
    const list = await entries(`${pdfMonth}-01`, dateInMonth(pdfMonth, 31));
    await saveFile(monthPdf(pdfMonth, list, data, todayInSaoPaulo()) as BlobPart, `extrato-${pdfMonth}.pdf`, "application/pdf");
    showNotice("PDF do mês gerado.");
  });

  return (
    <div className="export-panel">
      <p className="subtle" id={hintId}>Para o imposto de renda e para backup. Os arquivos são gerados no seu aparelho.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void csv();
        }}
      >
        <strong className="export-title">Planilha (CSV) de um período</strong>
        <div className="form-grid">
          <Field label="De" type="date" value={from} max={to} required onChange={(event) => setFrom(event.target.value)} />
          <Field label="Até" type="date" value={to} min={from} required onChange={(event) => setTo(event.target.value)} />
        </div>
        <button className="button secondary" disabled={Boolean(busy) || !online || !from || !to || from > to} aria-describedby={hintId}>
          {busy === "csv" ? "Gerando…" : "Baixar CSV"}
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void pdf();
        }}
      >
        <strong className="export-title">Extrato do mês (PDF)</strong>
        <div className="form-grid">
          <Field label="Mês" type="month" value={pdfMonth} max={month} required onChange={(event) => setPdfMonth(event.target.value)} full />
        </div>
        <button className="button secondary" disabled={Boolean(busy) || !online || !/^\d{4}-\d{2}$/.test(pdfMonth)}>
          {busy === "pdf" ? "Gerando…" : "Baixar PDF"}
        </button>
      </form>
      {!online && <p className="subtle">Sem conexão. A exportação volta quando a internet voltar.</p>}
    </div>
  );
}
