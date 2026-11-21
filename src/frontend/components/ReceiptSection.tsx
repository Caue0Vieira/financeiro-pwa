import { useEffect, useId, useRef, useState } from "react";
import type { Receipt, Receipts } from "../../contracts";
import { useOnline } from "../useOnline";
import { Icon } from "./common";

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

/** Entry detail → photos and PDFs attached to it. */
export function ReceiptSection({ entryId, receipts }: { entryId: string; receipts: Receipts }) {
  const [items, setItems] = useState<Receipt[]>();
  const [state, setState] = useState<"loading" | "ready" | "failed" | "uploading">("loading");
  const [problem, setProblem] = useState("");
  const [removing, setRemoving] = useState("");
  const [attempt, setAttempt] = useState(0);
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    let active = true;
    setState("loading");
    receipts.list(entryId)
      .then((list) => {
        if (!active) return;
        setItems(list);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
  }, [receipts, entryId, attempt]);

  async function attach(file: File | undefined) {
    if (!file) return;
    setProblem("");
    setState("uploading");
    try {
      const receipt = await receipts.add(entryId, file);
      setItems((list) => [...(list ?? []), receipt]);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Não foi possível anexar. Tente de novo.");
    } finally {
      setState("ready");
      if (input.current) input.current.value = "";
    }
  }

  async function detach(receipt: Receipt) {
    setProblem("");
    setRemoving(receipt.id);
    try {
      await receipts.remove(receipt.id);
      setItems((list) => list?.filter(({ id }) => id !== receipt.id));
    } catch {
      setProblem("Não foi possível remover. Tente de novo.");
    } finally {
      setRemoving("");
    }
  }

  return (
    <section className="receipts full" aria-labelledby={titleId}>
      <h3 id={titleId}>Comprovantes</h3>
      {state === "loading" && <p className="subtle">Carregando comprovantes…</p>}
      {state === "failed" && (
        <p className="subtle" role="alert">
          {online ? "Não foi possível carregar os comprovantes." : "Sem conexão. Os comprovantes aparecem quando a internet voltar."}{" "}
          <button type="button" className="text-button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button>
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="receipt-list">
          {items.map((receipt) => (
            <li key={receipt.id}>
              <a href={receipt.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${receipt.name}`}>
                {receipt.thumbnailUrl
                  ? <img src={receipt.thumbnailUrl} alt="" loading="lazy" />
                  : <span className="receipt-file" aria-hidden="true"><Icon name="receipt" size={22} />PDF</span>}
              </a>
              <span className="receipt-name" title={receipt.name}>{receipt.name}</span>
              <small>{size(receipt.size)}</small>
              <button
                type="button"
                className="text-button"
                disabled={removing === receipt.id || !online}
                onClick={() => void detach(receipt)}
                aria-label={`Remover ${receipt.name}`}
              >
                {removing === receipt.id ? "Removendo…" : "Remover"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {items?.length === 0 && state === "ready" && <p className="subtle">Nenhum comprovante. Anexe a foto da nota ou o PDF do recibo.</p>}
      {problem && <p className="inline-error" role="alert">{problem}</p>}
      {state !== "loading" && state !== "failed" && (
        <label className={`button secondary receipt-add${!online || state === "uploading" ? " disabled" : ""}`}>
          <Icon name="camera" size={16} /> {state === "uploading" ? "Enviando…" : "Anexar foto ou PDF"}
          <input
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            className="visually-hidden"
            disabled={!online || state === "uploading"}
            onChange={(event) => void attach(event.target.files?.[0])}
          />
        </label>
      )}
      {!online && state === "ready" && <p className="subtle">Conecte-se à internet para anexar.</p>}
    </section>
  );
}
