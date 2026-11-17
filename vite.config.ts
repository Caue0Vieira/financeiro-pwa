import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: command === 'build' ? [cloudflare()] : [],
  build: { target: 'safari16.4' },
}));
