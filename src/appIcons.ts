/** App icon choices, shared by the app (picker) and the Worker (manifest). */
export const appIcons = [
  { id: "esmeralda", label: "Esmeralda" },
  { id: "safira", label: "Safira" },
  { id: "ametista", label: "Ametista" },
  { id: "rubi", label: "Rubi" },
  { id: "ambar", label: "Âmbar" },
  { id: "grafite", label: "Grafite" },
] as const;

export type AppIconId = (typeof appIcons)[number]["id"];

export const defaultIcon: AppIconId = "esmeralda";

/** Cookie the Worker reads to serve /manifest.webmanifest with the chosen icon. */
export const iconCookie = "app_icon";

export function isAppIcon(value: unknown): value is AppIconId {
  return appIcons.some((icon) => icon.id === value);
}

export function iconPath(id: AppIconId, file = "icon-192.png") {
  return id === defaultIcon ? `/icons/${file}?v=4` : `/icons/${id}/${file}?v=4`;
}
