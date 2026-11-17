import { defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'financeiro-pwa',
    compatibilityDate: '2026-11-17',
    workersDev: true,
    previewUrls: false,
    assets: { notFoundHandling: 'single-page-application' },
  },
});
