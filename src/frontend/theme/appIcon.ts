import { useSyncExternalStore } from "react";
import { appIcons, defaultIcon, iconCookie, iconPath, isAppIcon, type AppIconId } from "../../appIcons";

export { appIcons, iconPath, type AppIconId };

const storageKey = "finance-app-icon";
const listeners = new Set<() => void>();

function readStoredIcon(): AppIconId {
  try {
    const stored = localStorage.getItem(storageKey);
    return isAppIcon(stored) ? stored : defaultIcon;
  } catch {
    return defaultIcon;
  }
}

let current = readStoredIcon();

export function readAppIcon(): AppIconId {
  return current;
}

/**
 * Points the favicon and the iOS home-screen icon at the chosen icon, sets data-accent so the
 * glass gradients follow its colour (see accents.css), and stores the choice in a cookie: the
 * Worker serves /manifest.webmanifest from it, so the manifest URL never changes and browsers
 * that update installed apps (Chrome on Android and desktop) pick up the new icon.
 */
export function applyAppIcon(id: AppIconId) {
  const head = document.head;
  document.documentElement.dataset.accent = id;
  head.querySelector('link[rel="icon"]')?.setAttribute("href", iconPath(id));
  head.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", iconPath(id, "apple-touch-icon.png"));
  document.cookie = `${iconCookie}=${id}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function saveAppIcon(id: AppIconId) {
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // Without storage the choice still applies to this visit.
  }
  current = id;
  applyAppIcon(id);
  listeners.forEach((notify) => notify());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useAppIcon() {
  return useSyncExternalStore(subscribe, readAppIcon);
}
