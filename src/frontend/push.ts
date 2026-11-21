import type { PushSubscriptionKeys } from "../contracts.ts";

/**
 * Browser side of Web Push: whether this device can receive it and the subscription keys.
 * On iPhone and iPad, Safari only delivers pushes to the app added to the home screen.
 */

export type PushSupport = "supported" | "unsupported" | "install";

type Device = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
};

export const isAppleMobile = ({ userAgent, platform, maxTouchPoints = 0 }: Pick<Device, "userAgent" | "platform" | "maxTouchPoints">) =>
  /iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);

export function pushSupport(device: Device): PushSupport {
  if (isAppleMobile(device) && !device.standalone) return "install";
  return device.serviceWorker && device.pushManager && device.notification ? "supported" : "unsupported";
}

export function currentDevice(): Device {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
  };
}

/** The VAPID key as the Push API wants it. */
export function applicationServerKey(base64url: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function subscriptionKeys(subscription: PushSubscription): PushSubscriptionKeys {
  const { keys } = subscription.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error("O navegador não entregou as chaves da inscrição.");
  return { endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** The service worker registration (registers it in development, where main.tsx doesn't). */
export async function workerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** Subscribes with the server key; a subscription made with an older key is replaced. */
export async function subscribe(registration: ServiceWorkerRegistration, publicKey: string) {
  const options = { userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) as BufferSource };
  try {
    return await registration.pushManager.subscribe(options);
  } catch (error) {
    const current = await registration.pushManager.getSubscription();
    if (!current) throw error;
    await current.unsubscribe();
    return registration.pushManager.subscribe(options);
  }
}

/** Endpoint the demo uses for "this device" (no push service involved). */
export const demoEndpoint = "demo:este-aparelho";
