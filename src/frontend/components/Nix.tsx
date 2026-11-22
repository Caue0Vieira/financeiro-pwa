import alerta from "../assets/nix/alerta.svg";
import alertaAnimado from "../assets/nix/alerta-animado.svg";
import feliz from "../assets/nix/feliz.svg";
import felizAnimado from "../assets/nix/feliz-animado.svg";
import meta from "../assets/nix/meta.svg";
import metaAnimado from "../assets/nix/meta-animado.svg";
import normal from "../assets/nix/normal.svg";
import normalAnimado from "../assets/nix/normal-animado.svg";

/** Nix, the assistant: a graphite pixel dragon whose eyes show the mood. */
export type NixMood = "normal" | "feliz" | "alerta" | "meta";

const art: Record<NixMood, { still: string; moving: string }> = {
  normal: { still: normal, moving: normalAnimado },
  feliz: { still: feliz, moving: felizAnimado },
  alerta: { still: alerta, moving: alertaAnimado },
  meta: { still: meta, moving: metaAnimado },
};

/** The animated files already stop moving under prefers-reduced-motion. */
export function Nix({ mood = "normal", animated = false, className = "" }: { mood?: NixMood; animated?: boolean; className?: string }) {
  const { still, moving } = art[mood];
  return <img className={`nix ${className}`.trim()} src={animated ? moving : still} alt="" aria-hidden="true" draggable={false} />;
}
