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
    // '0 */6 * * *' backs up the Pluggy webhook (imports what Pluggy already has for every
    // connection; src/worker/index.ts matches this exact string). The others price the B3 tickers:
    // hourly during the session (10h–18h in São Paulo = 13h–21h UTC) and once after the close.
    triggers: [
      triggers.scheduled({ schedule: '0 */6 * * *' }),
      triggers.scheduled({ schedule: '0 13-21 * * 1-5' }),
      triggers.scheduled({ schedule: '30 21 * * 1-5' }),
    ],
    // Values are set in Cloudflare, never committed: see README → "Open Finance (Pluggy)".
    env: {
      SUPABASE_URL: bindings.secret(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      PLUGGY_CLIENT_ID: bindings.secret(),
      PLUGGY_CLIENT_SECRET: bindings.secret(),
      PLUGGY_WEBHOOK_SECRET: bindings.secret(),
      // BRAPI_TOKEN is optional (quotes fall back to Yahoo Finance) and so is not declared here:
      // declared secrets are required. Set it with `cf workers secrets update`; see the README.
    },
  },
});
