import { useEffect, useRef, useState } from "react";
import type { Profile } from "../../contracts";
import { Avatar } from "./common";
import { Overlay } from "./Overlay";

export function ProfilePhotoDialog({
  profile,
  onSave,
  onClose,
}: {
  profile: Profile;
  onSave: (photo: File | null) => Promise<void>;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ file: File; url: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previewUrl = draft?.url;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function save(photo: File | null) {
    setBusy(true);
    setError("");
    try {
      await onSave(photo);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar a foto.");
      setBusy(false);
    }
  }

  return (
    <Overlay title="Foto de perfil" onClose={() => { if (!busy) onClose(); }}>
      <div className="profile-photo" aria-busy={busy}>
        {draft ? (
          <span className="avatar">
            <img
              key={draft.url}
              src={draft.url}
              alt="Prévia da nova foto"
              onError={() => {
                setDraft(undefined);
                setError("Não foi possível abrir a imagem. Tente uma foto em JPEG, PNG ou WebP.");
              }}
            />
          </span>
        ) : (
          <Avatar profile={profile} />
        )}
        <p className="subtle" role="status">
          {draft ? "Prévia da nova foto" : profile.avatarUrl ? "Foto atual" : "Nenhuma foto de perfil"}
        </p>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file?.size) return;
            setDraft({ file, url: URL.createObjectURL(file) });
            setError("");
          }}
        />
        {error && <p className="profile-photo-error" role="alert">{error}</p>}
        <div className="profile-photo-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => input.current?.click()}>
            Escolher foto
          </button>
          {draft && (
            <button type="button" className="button" disabled={busy} onClick={() => void save(draft.file)}>
              {busy ? "Salvando…" : "Salvar foto"}
            </button>
          )}
        </div>
        {profile.avatarUrl && !draft && (
          <button type="button" className="text-button" disabled={busy} onClick={() => void save(null)}>
            Remover foto
          </button>
        )}
      </div>
    </Overlay>
  );
}
