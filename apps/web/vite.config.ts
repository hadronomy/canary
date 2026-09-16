import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { varlockVitePlugin } from '@varlock/vite-integration';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

import { caddyPlugin } from './src/vite-plugin-caddy';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    // The parent process resolves the schema, so the plugin only installs the runtime guards.
    varlockVitePlugin({ ssrInjectMode: 'init-only' }),
    devtools({
      eventBusConfig: {
        debug: false,
        enabled: true,
      },
    }),
    caddyPlugin(),
    tailwindcss(),
    tanstackStart(),
    nitro({ plugins: ['./plugins/runtime.ts'] }),
    viteReact(),
  ],
  server: {
    port: 3001,
  },
});
