import { useId, useState } from "react";
import { maxTags, normalizeTags } from "../../search";
import { Icon } from "./common";

/** Free tags of an entry: type and press Enter or comma; suggestions come from tags already used. */
export function TagField({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const commit = (text = draft) => {
    const next = normalizeTags([...value, ...normalizeTags(text)]);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const full = value.length >= maxTags;
  return (
    <div className="field full tag-field">
      <label htmlFor={inputId}>Tags</label>
      {value.length > 0 && (
        <ul className="tag-chips" aria-label="Tags do lançamento">
          {value.map((tag) => (
            <li key={tag}>
              <span>#{tag}</span>
              <button type="button" aria-label={`Remover tag ${tag}`} onClick={() => onChange(value.filter((item) => item !== tag))}>
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={inputId}
        list={listId}
        value={draft}
        disabled={full}
        maxLength={30}
        placeholder={full ? "Limite de 10 tags" : "Ex.: viagem rio, reforma"}
        aria-describedby={hintId}
        onChange={(event) => {
          const text = event.target.value;
          if (/[,;]/.test(text)) commit(text);
          else setDraft(text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.trim()) {
            event.preventDefault();
            commit();
          }
          if (event.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && commit()}
      />
      <datalist id={listId}>
        {suggestions.filter((tag) => !value.includes(tag)).map((tag) => <option key={tag} value={tag} />)}
      </datalist>
      <small id={hintId} className="subtle">Separe com vírgula ou Enter. Use para agrupar gastos, como uma viagem ou uma obra.</small>
    </div>
  );
}
