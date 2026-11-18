import { defaultIcon, iconCookie, iconPath, isAppIcon } from "../appIcons.ts";

type Manifest = { icons: { src: string }[] } & Record<string, unknown>;

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
  manifest.icons = manifest.icons.map((entry) => {
    const file = entry.src.match(/\/([^/?]+\.png)/)?.[1];
    return file ? { ...entry, src: iconPath(icon, file) } : entry;
  });
  return JSON.stringify(manifest);
}
