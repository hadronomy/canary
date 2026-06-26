import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

import { caddyPlugin } from './src/vite-plugin-caddy';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    devtools({
      eventBusConfig: {
        debug: false,
        enabled: true,
      },
    }),
    caddyPlugin(),
    tailwindcss(),
    tanstackStart(),
    nitro(),
    viteReact(),
  ],
  server: {
    port: 3001,
  },
});
