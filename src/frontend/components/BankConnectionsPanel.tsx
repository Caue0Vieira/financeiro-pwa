import { useCallback, useEffect, useState } from "react";
import type { BankConnection, BankConnections } from "../../contracts";
import { useTheme } from "../theme/ThemeProvider";
import { BankIcon } from "./BankIcon";
import { Icon } from "./common";

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
function syncedLabel(iso: string | null) {
  if (!iso) return "Ainda não sincronizado";
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return `Atualizado ${relative.format(minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `Atualizado ${relative.format(hours, "hour")}`;
  return `Atualizado ${relative.format(Math.round(hours / 24), "day")}`;
}
const needsAttention = (status: string | null) =>
  Boolean(status && /error|waiting|login|outdated/i.test(status));
const imported = (count: number) =>
  count === 0 ? "Nenhuma compra nova." : count === 1 ? "1 lançamento importado." : `${count} lançamentos importados.`;

/**
 * Open Finance (Pluggy): connect banks, sync and disconnect. New purchases also arrive on their
 * own through the server webhook; "Sincronizar" asks the banks for fresh data right away.
 */
export function BankConnectionsPanel({
  connections,
  onImported,
  showNotice,
}: {
  connections?: BankConnections;
  onImported: () => Promise<void>;
  showNotice: (message: string, kind?: "success" | "error") => void;
}) {
  const { resolvedTheme } = useTheme();
  const [items, setItems] = useState<BankConnection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [itemId, setItemId] = useState("");

  const load = useCallback(async () => {
    if (connections) setItems(await connections.list());
  }, [connections]);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    void load().catch(() => setLoadFailed(true));
  }, [load]);

  async function run(key: string, task: () => Promise<string | void>) {
    setBusy(key);
    try {
      const message = await task();
      await Promise.all([load(), onImported()]);
      if (message) showNotice(message);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Não foi possível concluir.", "error");
    } finally {
      setBusy(null);
    }
  }

  /** Opens Pluggy Connect; `itemId` reconnects an existing bank (e.g. after a password change). */
  async function connect(itemId?: string) {
    if (!connections) return;
    setBusy(itemId ?? "connect");
    try {
      const [connectToken, { PluggyConnect }] = await Promise.all([
        connections.connectToken(itemId),
        import("pluggy-connect-sdk"),
      ]);
      await new PluggyConnect({
        connectToken,
        updateItem: itemId,
        includeSandbox: import.meta.env.DEV,
        language: "pt",
        theme: resolvedTheme,
        onSuccess: ({ item }) =>
          run(item.id, async () => imported((await connections.register(item.id)).inserted)),
        onError: ({ message }) => showNotice(message || "A conexão com o banco não foi concluída.", "error"),
        onClose: () => setBusy((current) => (current === (itemId ?? "connect") ? null : current)),
      }).init();
    } catch (error) {
      setBusy(null);
      showNotice(error instanceof Error ? error.message : "Não foi possível abrir a conexão.", "error");
    }
  }

  if (!connections) {
    return (
      <section className="panel bank-connections">
        <header className="panel-head"><h2>Open Finance</h2></header>
        <p className="subtle">Conecte seus bancos para importar compras automaticamente. Disponível ao entrar na sua conta.</p>
      </section>
    );
  }

  return (
    <section className="panel screen-list bank-connections" aria-busy={busy !== null}>
      <header className="panel-head">
        <h2>Open Finance</h2>
        {items.length > 0 && (
          <button
            className="text-button"
            disabled={busy !== null}
            onClick={() => void run("sync", async () => imported((await connections.sync()).inserted))}
          >
            <Icon name="repeat" size={15} /> {busy === "sync" ? "Sincronizando…" : "Sincronizar"}
          </button>
        )}
      </header>
      {loadFailed && <p role="alert" className="subtle">Não foi possível carregar as conexões bancárias.</p>}
      {items.length === 0 && !loadFailed && (
        <p className="subtle">
          Conecte o seu banco pelo Meu Pluggy (grátis para uso pessoal) e as compras novas entram sozinhas, já na
          fatura certa do cartão.
        </p>
      )}
      {items.map((item) => (
        <div className="bank-connection" key={item.itemId}>
          <div className="transaction">
            <BankIcon bank={item.bank} />
            <span className="transaction-info">
              <strong>{item.bank}</strong>
              <span>{needsAttention(item.status) ? "Precisa reconectar" : syncedLabel(item.lastSyncedAt)}</span>
            </span>
          </div>
          <div className="bank-connection-actions">
            {needsAttention(item.status) && (
              <button className="text-button" disabled={busy !== null} onClick={() => void connect(item.itemId)}>
                Reconectar
              </button>
            )}
            {confirmRemove === item.itemId ? (
              <>
                <span className="subtle">Desconectar? Os lançamentos já importados continuam.</span>
                <button
                  className="text-button danger-text"
                  disabled={busy !== null}
                  onClick={() => void run(item.itemId, async () => {
                    await connections.remove(item.itemId);
                    setConfirmRemove(null);
                    return `${item.bank} desconectado.`;
                  })}
                >
                  Confirmar
                </button>
                <button className="text-button" onClick={() => setConfirmRemove(null)}>Cancelar</button>
              </>
            ) : (
              <button className="text-button" disabled={busy !== null} onClick={() => setConfirmRemove(item.itemId)}>
                Desconectar
              </button>
            )}
          </div>
        </div>
      ))}
      <form
        className="bank-link"
        onSubmit={(event) => {
          event.preventDefault();
          const id = itemId.trim();
          void run("link", async () => {
            const { inserted } = await connections.register(id);
            setItemId("");
            return `Conexão vinculada. ${imported(inserted)}`;
          });
        }}
      >
        <label className="field full">
          Vincular conexão do Meu Pluggy
          <input
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            placeholder="Cole o ID da conexão (Item ID)"
            pattern="\s*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\s*"
            title="O ID tem o formato 00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <button className="button" disabled={busy !== null}>{busy === "link" ? "Vinculando…" : "Vincular"}</button>
      </form>
      <details className="form-details bank-link-help">
        <summary>Como pegar o ID no Meu Pluggy</summary>
        <ol>
          <li>Em meu.pluggy.ai, crie a conta e conecte o seu banco.</li>
          <li>No painel da Pluggy, abra a sua aplicação e habilite o conector MeuPluggy, se ele não aparecer.</li>
          <li>Crie uma conexão, escolha MeuPluggy, entre com a conta do Meu Pluggy e autorize.</li>
          <li>Copie o ID da conexão (Item ID) e cole acima. Faça isso para cada banco.</li>
        </ol>
        <p className="subtle">Os dados atualizam sozinhos uma vez por dia pelo Meu Pluggy.</p>
      </details>
      <button className="text-button bank-connect-widget" disabled={busy !== null} onClick={() => void connect()}>
        <Icon name="bank" size={15} /> {busy === "connect" ? "Abrindo…" : "Conectar direto pela Pluggy (plano pago)"}
      </button>
    </section>
  );
}
