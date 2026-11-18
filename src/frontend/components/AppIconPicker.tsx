import { appIcons, iconPath, saveAppIcon, useAppIcon } from "../theme/appIcon";

export function AppIconPicker({ onChange }: { onChange?: (label: string) => void }) {
  const current = useAppIcon();

  return (
    <div className="app-icon-picker">
      <div className="app-icon-grid" role="radiogroup" aria-label="Ícone do app">
        {appIcons.map((icon) => (
          <button
            key={icon.id}
            type="button"
            role="radio"
            aria-checked={current === icon.id}
            className="app-icon-option"
            onClick={() => {
              if (icon.id === current) return;
              saveAppIcon(icon.id);
              onChange?.(icon.label);
            }}
          >
            <img src={iconPath(icon.id)} alt="" width={56} height={56} loading="lazy" />
            <span>{icon.label}</span>
          </button>
        ))}
      </div>
      <p className="subtle">
        Muda na hora no app e na aba do navegador. Na tela inicial, o Android e o Chrome atualizam o ícone sozinhos
        em até um dia (podem pedir confirmação). No iPhone, remova o app da tela inicial e adicione de novo.
      </p>
    </div>
  );
}
