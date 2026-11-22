import { useCallback, useEffect, useState } from "react";
import type { BankConnections, PluggyAppStatus } from "../../contracts";

/**
 * The user's own Pluggy application (Meu Pluggy only accepts the holder's own accounts, so each
 * person needs their own). The secret goes to the Worker, which checks it with Pluggy, creates
 * the webhook there and never sends it back.
 */
export function PluggyAppForm({
  connections,
  hasConnections,
  showNotice,
}: {
  connections: BankConnections;
  hasConnections: boolean;
  showNotice: (message: string, kind?: "success" | "error") => void;
}) {
  const [status, setStatus] = useState<PluggyAppStatus>();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const load = useCallback(async () => setStatus(await connections.app()), [connections]);
  useEffect(() => {
    void load().catch(() => setStatus(undefined));
  }, [load]);

  async function run(task: () => Promise<string>) {
    setBusy(true);
    try {
      const message = await task();
      await load();
      showNotice(message);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Não foi possível concluir.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!status || (!status.available && !status.own)) return null;
  const own = status.own;
  const showForm = editing || (!own && !status.serverApp);

  const form = (
    <form
      className="pluggy-app-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const saved = await connections.saveApp(clientId.trim(), clientSecret.trim());
          setClientId("");
          setClientSecret("");
          setEditing(false);
          return saved.webhook
            ? "Aplicação da Pluggy salva. As compras novas chegam sozinhas."
            : "Aplicação salva, mas a Pluggy não criou o webhook. Use Sincronizar; o backup de hora em hora também importa.";
        });
      }}
    >
      <label className="field full">
        Client ID
        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          pattern="\s*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\s*"
          title="O Client ID tem o formato 00000000-0000-0000-0000-000000000000"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <label className="field full">
        Client Secret
        <input
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          minLength={8}
          required
        />
      </label>
      <div className="pluggy-app-actions">
        <button className="button" disabled={busy}>{busy ? "Verificando…" : "Salvar aplicação"}</button>
        {editing && (
          <button type="button" className="text-button" onClick={() => setEditing(false)}>Cancelar</button>
        )}
      </div>
    </form>
  );

  if (!own) {
    return (
      <div className="pluggy-app">
        <h3>Sua aplicação da Pluggy</h3>
        {showForm ? (
          <>
            <p className="subtle">
              O Meu Pluggy só aceita as suas próprias contas. Crie a sua aplicação grátis em{" "}
              <strong>dashboard.pluggy.ai</strong> e cole aqui o Client ID e o Client Secret dela. O segredo fica só no
              servidor.
            </p>
            {form}
          </>
        ) : (
          <details className="form-details">
            <summary>Usar a minha própria aplicação da Pluggy</summary>
            <p className="subtle">
              Para quem tem outra conta no Meu Pluggy: o Meu Pluggy só aceita as contas do titular. Cole o Client ID e o
              Client Secret da sua aplicação em <strong>dashboard.pluggy.ai</strong>; as conexões novas passam a usar ela.
            </p>
            {form}
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="pluggy-app">
      <h3>Sua aplicação da Pluggy</h3>
      <p className="subtle">
        Client ID terminado em <code>{own.clientId.slice(-4)}</code>.{" "}
        {own.webhook
          ? "As compras novas chegam sozinhas pelo webhook."
          : "Sem webhook: as compras entram pelo Sincronizar e pelo backup de hora em hora."}
      </p>
      {showForm ? form : (
        <div className="pluggy-app-actions">
          <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(true)}>
            Trocar credenciais
          </button>
          {confirmRemove ? (
            <>
              <span className="subtle">Remover a aplicação?</span>
              <button
                type="button"
                className="text-button danger-text"
                disabled={busy}
                onClick={() => void run(async () => {
                  await connections.removeApp();
                  setConfirmRemove(false);
                  return "Aplicação da Pluggy removida.";
                })}
              >
                Confirmar
              </button>
              <button type="button" className="text-button" onClick={() => setConfirmRemove(false)}>Cancelar</button>
            </>
          ) : (
            <button
              type="button"
              className="text-button"
              disabled={busy || hasConnections}
              title={hasConnections ? "Desconecte os bancos desta aplicação antes de removê-la." : undefined}
              onClick={() => setConfirmRemove(true)}
            >
              Remover
            </button>
          )}
        </div>
      )}
    </div>
  );
}
