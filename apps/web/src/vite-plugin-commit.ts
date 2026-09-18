import type { Plugin, ViteDevServer } from 'vite';

import { spawnSync } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

const ID = 'virtual:commit';
const RESOLVED = `\0${ID}`;

function git(...args: string[]) {
  // spawnSync rather than execSync so a missing repo is a status code instead
  // of an exception the plugin would have to catch.
  const out = spawnSync('git', args, { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : '';
}

/**
 * Exposes the checked-out commit as `virtual:commit`.
 *
 * Read through git rather than baked into an env var so it is correct in both
 * dev and build, and watched in dev so the footer follows along as you commit
 * instead of going stale until the next restart.
 */
export function commitPlugin(): Plugin {
  const watchers: FSWatcher[] = [];

  return {
    name: 'canary:commit',

    resolveId(id) {
      if (id === ID) return RESOLVED;
      return null;
    },

    load(id) {
      if (id !== RESOLVED) return null;
      return `export const COMMIT = ${JSON.stringify(git('rev-parse', '--short', 'HEAD') || 'unknown')};`;
    },

    configureServer(server: ViteDevServer) {
      const dir = git('rev-parse', '--absolute-git-dir');
      if (!dir) return;

      // Vite's own watcher ignores `.git`, and adding paths to it does not
      // override that, so this watches the directory itself. Directories rather
      // than files because git replaces refs by rename, which detaches a watch
      // bound to the old inode.
      const heads = path.join(dir, 'refs', 'heads');
      let timer: ReturnType<typeof setTimeout> | undefined;

      function bump() {
        // Git touches several files per commit; one reload is enough.
        clearTimeout(timer);
        timer = setTimeout(() => {
          const mod = server.moduleGraph.getModuleById(RESOLVED);
          if (!mod) return;
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }, 120);
      }

      if (existsSync(dir)) watchers.push(watch(dir, bump));
      if (existsSync(heads)) watchers.push(watch(heads, { recursive: true }, bump));
    },

    closeBundle() {
      for (const w of watchers) w.close();
      watchers.length = 0;
    },
  };
}
