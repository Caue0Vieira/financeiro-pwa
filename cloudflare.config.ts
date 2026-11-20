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
    // Backup for the Pluggy webhook: each hour imports what Pluggy has for the connection synced
    // longest ago (one per run, for the free plan's subrequest limit), then runs Workers AI.
    triggers: [triggers.scheduled({ schedule: '0 * * * *' })],
    // Values are set in Cloudflare, never committed: see README → "Open Finance (Pluggy)".
    env: {
      SUPABASE_URL: bindings.secret(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      PLUGGY_CLIENT_ID: bindings.secret(),
      PLUGGY_CLIENT_SECRET: bindings.secret(),
      PLUGGY_WEBHOOK_SECRET: bindings.secret(),
      // Workers AI: categorises what no learned rule covers (src/worker/categorize.ts).
      AI: bindings.ai(),
    },
  },
});
