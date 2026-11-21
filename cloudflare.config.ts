import { bindings, defineConfig, triggers } from 'cf/config';
import * as entrypoint from './src/worker/index.ts' with { type: 'cf-worker' };

export default defineConfig({
  worker: {
    name: 'financeiro-pwa',
    compatibilityDate: '2026-11-17',
    // Server code answers /api/* (Pluggy) and the manifest (icon choice). The rest is static.
    entrypoint,
    workersDev: true,
    previewUrls: false,
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*', '/manifest.webmanifest'] },
    // Hourly: even hours (São Paulo) are the Pluggy webhook backup (imports the connection synced
    // longest ago, then runs Workers AI); odd hours send the push notices. They take turns because
    // of the free plan's subrequest limit per invocation (src/worker/index.ts → scheduledWork).
    triggers: [triggers.scheduled({ schedule: '0 * * * *' })],
    // Values are set in Cloudflare, never committed: see README → "Open Finance (Pluggy)".
    env: {
      SUPABASE_URL: bindings.secret(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      PLUGGY_CLIENT_ID: bindings.secret(),
      PLUGGY_CLIENT_SECRET: bindings.secret(),
      PLUGGY_WEBHOOK_SECRET: bindings.secret(),
      // Web Push (VAPID): see README → "Notificações push".
      VAPID_PUBLIC_KEY: bindings.secret(),
      VAPID_PRIVATE_KEY: bindings.secret(),
      // Workers AI: categorises what no learned rule covers (src/worker/categorize.ts).
      AI: bindings.ai(),
    },
  },
});
