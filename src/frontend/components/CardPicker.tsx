import type { Account, Action } from "../../contracts";
import type { OpenEditor } from "../types";
import { BankIcon, bankSuggestions } from "./BankIcon";
import { Icon } from "./common";
import { Overlay } from "./Overlay";

export default function CardPicker({
  accounts,
  busy,
  error,
  close,
  openEditor,
  save,
}: {
  accounts: Account[];
  busy: boolean;
  error: string;
  close: () => void;
  openEditor: OpenEditor;
  save: (action: Action) => Promise<void>;
}) {
  const options = new Map<string, string>();
  for (const name of [...accounts.map((account) => account.name), ...bankSuggestions]) {
    const key = name.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (!options.has(key)) options.set(key, name);
  }

  return (
    <Overlay title="Adicionar cartão" onClose={close}>
      <p className="form-hint">Toque no banco para criar o cartão.</p>
      <div className="bank-picker" role="group" aria-label="Bancos" aria-busy={busy}>
        {[...options.values()].map((bank) => (
          <button
            className="bank-choice"
            key={bank}
            type="button"
            disabled={busy}
            onClick={() => void save({ type: "saveCard", card: { name: bank, bank, dueDay: null } })}
          >
            <BankIcon bank={bank} />
            <span>{bank}</span>
            <Icon name="plus" size={15} />
          </button>
        ))}
      </div>
      {busy && <p className="form-hint" role="status">Cadastrando cartão…</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={() => openEditor({ type: "card", standalone: true })}>
          Cartão avulso
        </button>
        <button type="button" className="text-button" disabled={busy} onClick={() => openEditor({ type: "card" })}>
          Outro banco
        </button>
      </div>
    </Overlay>
  );
}
