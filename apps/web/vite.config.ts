import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { varlockVitePlugin } from '@varlock/vite-integration';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, type Plugin } from 'vite';

import { caddyPlugin } from './src/vite-plugin-caddy';
import { commitPlugin } from './src/vite-plugin-commit';

// The shipped loader matches on `id.endsWith('.wgsl')`, but Vite hands dev-time
// ids over with a `?import` query attached, so the transform never fires and
// raw WGSL reaches import-analysis as if it were JavaScript. Strip the query
// and delegate; `enforce: 'pre'` keeps it ahead of the rest of the pipeline.
function wgsl(): Plugin {
  const inner = wgslVitePlugin();
  return {
    name: 'canary:wgsl',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!file.endsWith('.wgsl')) return null;
      return inner.transform.call(this, code, file);
    },
  };
}

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
    commitPlugin(),
    wgsl(),
    tailwindcss(),
    tanstackStart(),
    nitro({ plugins: ['./plugins/runtime.ts'] }),
    viteReact(),
  ],
  server: {
    port: 3001,
  },
});
