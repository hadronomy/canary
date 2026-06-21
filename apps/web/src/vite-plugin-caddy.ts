import type { Plugin, ViteDevServer } from 'vite';

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

type Options = {
  autoStart?: boolean;
  configPath?: string;
  encoding?: boolean;
  host?: string;
  httpsPort?: number;
};

export function caddyPlugin(opts: Options = {}): Plugin {
  const cfg = {
    autoStart: opts.autoStart ?? true,
    configPath: opts.configPath ?? 'Caddyfile',
    encoding: opts.encoding ?? true,
    host: opts.host ?? 'localhost',
    httpsPort: opts.httpsPort ?? 3443,
  };
  let child: ChildProcess | null = null;
  let port: number | undefined;
  let active = false;

  function file(vite: number) {
    return `{
\tauto_https disable_redirects
}

localhost:${cfg.httpsPort} {
\treverse_proxy ${cfg.host}:${vite}${
      cfg.encoding
        ? `
\tencode gzip`
        : ''
    }
}
`;
  }

  function stop() {
    if (!child || child.killed) {
      return;
    }

    child.kill('SIGTERM');
    child = null;
  }

  function start(root: string) {
    if (!cfg.autoStart || !port || active) {
      return;
    }

    active = true;

    const check = spawnSync('caddy', ['--version'], { stdio: 'ignore' });

    if (check.error || check.status !== 0) {
      console.warn(
        'Caddy is not installed. Install it and run `caddy trust` to test Electric sync over HTTPS/HTTP2.',
      );
      return;
    }

    const dst = path.resolve(root, cfg.configPath);
    writeFileSync(dst, file(port));

    child = spawn('caddy', ['run', '--config', dst], {
      stdio: 'inherit',
    });
    child.on('exit', () => {
      child = null;
    });
  }

  function ready(server: ViteDevServer) {
    port = server.config.server.port ?? port;
    start(server.config.root);
  }

  return {
    name: 'canary-caddy',
    apply: 'serve',
    configureServer(server) {
      server.printUrls = () => {
        console.log();
        console.log(`  ➜  Local:   https://localhost:${cfg.httpsPort}/`);
        console.log(`  ➜  Vite:    http://localhost:${server.config.server.port ?? 3001}/`);
        console.log();
      };

      const listen = server.listen;

      server.listen = function serve(next?: number, restart?: boolean) {
        port = next ?? port;
        const res = listen.call(this, next, restart);

        if (res && typeof res.then === 'function') {
          res.then(() => ready(server));
          return res;
        }

        ready(server);
        return res;
      };

      server.httpServer?.once('close', stop);
    },
    buildEnd() {
      stop();
    },
  };
}
