export const appIcons = [
  { id: "esmeralda", label: "Esmeralda" },
  { id: "safira", label: "Safira" },
  { id: "ametista", label: "Ametista" },
  { id: "rubi", label: "Rubi" },
  { id: "ambar", label: "Âmbar" },
  { id: "grafite", label: "Grafite" },
] as const;

export type AppIconId = (typeof appIcons)[number]["id"];

const storageKey = "finance-app-icon";
const defaultIcon: AppIconId = "esmeralda";

function isAppIcon(value: unknown): value is AppIconId {
  return appIcons.some((icon) => icon.id === value);
}

export function iconPath(id: AppIconId, file = "icon-192.png") {
  return id === defaultIcon ? `/icons/${file}?v=4` : `/icons/${id}/${file}?v=4`;
}

export function readAppIcon(): AppIconId {
  try {
    const stored = localStorage.getItem(storageKey);
    return isAppIcon(stored) ? stored : defaultIcon;
  } catch {
    return defaultIcon;
  }
}

/** Points the favicon, the iOS home-screen icon and the install manifest at the chosen icon. */
export function applyAppIcon(id: AppIconId) {
  const head = document.head;
  head.querySelector('link[rel="icon"]')?.setAttribute("href", iconPath(id));
  head.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", iconPath(id, "apple-touch-icon.png"));
  head
    .querySelector('link[rel="manifest"]')
    ?.setAttribute("href", id === defaultIcon ? "/manifest.webmanifest" : `/manifest-${id}.webmanifest`);
}

export function saveAppIcon(id: AppIconId) {
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // Without storage the choice still applies to this visit.
  }
  applyAppIcon(id);
}
