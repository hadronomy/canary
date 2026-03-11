#!/usr/bin/env bun

import { intro, log, outro, spinner } from '@clack/prompts';
import { $ } from 'bun';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const session = process.env.TMUX_SESSION ?? 'canary-agent-examples';
const worker = 'worker';
const server = 'server';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wport = Number(process.env.RESTATE_WORKER_PORT ?? '9080');
const sport = 3000;

async function free(port: number, name: string) {
  const raw = (await $`lsof -ti tcp:${port}`.nothrow().quiet().text()).trim();
  if (!raw) {
    return;
  }

  const pids = raw
    .split('\n')
    .map((pid) => pid.trim())
    .filter((pid) => pid.length > 0);
  if (pids.length === 0) {
    return;
  }

  await Promise.all(pids.map((pid) => $`kill ${pid}`.nothrow().quiet()));
  return `${name}:${String(port)}:${pids.join(',')}`;
}

async function main() {
  intro('Run @canary/agent examples');
  const s = spinner();
  s.start('Preparing tmux session');

  const killed = await $`tmux kill-session -t ${session}`.nothrow().quiet();
  const restarted = killed.exitCode === 0;

  const stopped = [await free(wport, worker), await free(sport, server)].filter(
    (entry): entry is string => Boolean(entry),
  );

  await $`tmux new-session -d -s ${session} -n ${worker} -c ${root}`.quiet();
  await $`tmux send-keys -t ${session}:${worker} "bun examples/restate-worker.ts" Enter`.quiet();
  await $`tmux new-window -t ${session} -n ${server} -c ${root}`.quiet();
  await $`tmux send-keys -t ${session}:${server} "bun examples/server.ts" Enter`.quiet();
  await $`tmux select-window -t ${session}:${worker}`.quiet();

  s.stop('Examples are running in tmux');
  if (restarted) {
    log.info(`Restarted existing session '${session}'`);
  }
  if (stopped.length > 0) {
    log.info(`Stopped old listeners: ${stopped.join(' | ')}`);
  }

  log.success(`Started session '${session}' with windows '${worker}' and '${server}'`);
  outro(`Attach with: tmux attach -t ${session}`);
}

await main();
