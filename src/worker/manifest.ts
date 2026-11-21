import { defaultIcon, iconCookie, iconPath, isAppIcon } from "../appIcons.ts";

type Icon = { src: string };
type Manifest = { icons: Icon[]; shortcuts?: { icons?: Icon[] }[] } & Record<string, unknown>;

/** The icon chosen in the app (cookie set by theme/appIcon.ts), or the default one. */
export function chosenIcon(cookieHeader: string | null) {
  const value = cookieHeader?.split(";").map((part) => part.trim().split("="))
    .find(([name]) => name === iconCookie)?.[1];
  return isAppIcon(value) ? value : defaultIcon;
}

/**
 * public/manifest.webmanifest with its icons pointed at the chosen variant. The URL stays the
 * same for every choice, which is what lets Chrome update the icon of an installed app.
 */
export function manifestFor(source: string, cookieHeader: string | null) {
  const manifest = JSON.parse(source) as Manifest;
  const icon = chosenIcon(cookieHeader);
  const pointed = (entries: Icon[]) => entries.map((entry) => {
    const file = entry.src.match(/\/([^/?]+\.png)/)?.[1];
    return file ? { ...entry, src: iconPath(icon, file) } : entry;
  });
  manifest.icons = pointed(manifest.icons);
  // Shortcuts ("Novo gasto") show the same icon as the app.
  manifest.shortcuts = manifest.shortcuts?.map((shortcut) => (shortcut.icons ? { ...shortcut, icons: pointed(shortcut.icons) } : shortcut));
  return JSON.stringify(manifest);
}
