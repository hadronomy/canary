import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import type { Part } from '@canary/sync';

import { TaskRows } from '~/components/agent/task-rows';
import { ToolChips } from '~/components/agent/tool-chips';
import { AssistantMessage, AssistantPending, UserMessage } from '~/components/agent/turn';
import { AgentPrompt } from '~/components/composer/prompt';
import { Button } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
import { cn } from '~/lib/utils';

/**
 * Every shape a conversation can take, on one page.
 *
 * Preview-only, and it renders the same components the transcript does rather
 * than a copy of their markup — a gallery built from its own markup only ever
 * proves that the copy looks right.
 *
 * The point is the things that are hard to reach in a real thread: a tool that
 * failed, reasoning still streaming, a table that overflows, a message that is
 * one unbroken 300-character token. Those are where the spacing and the radii
 * actually get tested, and they are exactly what you cannot summon on demand
 * by talking to an agent.
 */
export const Route = createFileRoute('/design/chat')({
  component: Gallery,
});

let seq = 0;

/** A part, with only the fields the presentation reads. */
function part(input: Partial<Part> & Pick<Part, 'kind' | 'status'>): Part {
  seq += 1;

  return {
    id: `part-${seq}`,
    messageId: 'msg',
    threadId: 'thread',
    ownerId: 'owner',
    index: seq,
    content: '',
    data: null,
    toolName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...input,
  } as Part;
}

const PROSE = `Here is what I found. The \`keepalive\` proxy drops its socket when the
upstream closes mid-flight, which is why the retry loop never fires.

### What changes

1. Treat a mid-flight close as retryable rather than terminal.
2. Back off on the **second** failure, not the first — a single close is normal.
3. Surface the attempt count so a run that recovered still says so.

| Path | Change | Risk |
| --- | --- | --- |
| \`packages/sync/keepalive.ts\` | retry on close | low |
| \`packages/sync/socket.ts\` | expose attempts | none |
| \`apps/web/src/utils/chat.ts\` | surface state | low |

\`\`\`ts
export function retryable(err: unknown) {
  // A close during a request is the upstream recycling a socket, not a
  // failure — the request simply has to be made again.
  return err instanceof SocketClose && err.phase === 'in-flight';
}
\`\`\`

> A close during a request is not an error, it is a socket being recycled.

See [the keepalive notes](https://example.com) for the original trace.`;

const REASONING = `The retry loop reads \`err.code\`, but a mid-flight close arrives as a
\`SocketClose\` with no code at all, so the guard falls through to the terminal
branch. Checking the phase rather than the code would catch both.`;

const SCENES = [
  {
    id: 'plain',
    title: 'Plain exchange',
    note: 'The common case: a question, and prose back.',
    user: 'Why does the sync keepalive drop its socket on redeploy?',
    segment: { live: false, parts: [], text: PROSE },
  },
  {
    id: 'streaming',
    title: 'Streaming',
    note: 'Mid-reply. The markdown renderer is in streaming mode, so an unclosed fence still renders.',
    user: 'Walk me through the fix.',
    segment: {
      live: true,
      parts: [],
      text: '**Working through it now.** The guard reads `err.code`, but a mid-flight close carries\n\n```ts\nexport function retryable(err: unknown) {\n  return err instanceof SocketClose',
    },
  },
  {
    id: 'pending',
    title: 'Waiting on the first part',
    note: 'The run has started and nothing has arrived. This header sits exactly where a reasoning header would, so a trace that lands next does not move it.',
    user: 'Why is the keepalive test flaky?',
    pending: true,
    segment: { live: true, parts: [], text: '' },
  },
  {
    id: 'reasoning',
    title: 'Reasoning, settled',
    note: 'Collapsed by default once the run is done — it is there to be opened, not read.',
    user: 'What made you look at the phase instead of the code?',
    segment: {
      live: false,
      parts: [
        part({
          kind: 'reasoning',
          status: 'completed',
          content: REASONING,
          createdAt: new Date(Date.now() - 4200),
          updatedAt: new Date(),
        }),
      ],
      text: '',
    },
  },
  {
    id: 'reasoning-live',
    title: 'Reasoning, streaming',
    note: 'Held open while it runs, because a disclosure that fills in behind a closed summary is a thing you never see.',
    user: 'Think it through.',
    segment: {
      live: true,
      parts: [part({ kind: 'reasoning', status: 'running', content: REASONING })],
      text: '',
    },
  },
  {
    id: 'tools',
    title: 'Tool work',
    note: 'Consecutive tool parts collapse into one log rather than a stack of panels.',
    user: 'Find every call site and check the types.',
    segment: {
      live: true,
      parts: [
        part({
          kind: 'tool-call',
          status: 'completed',
          toolName: 'read',
          data: { path: 'packages/sync/src/keepalive.ts' },
        }),
        part({
          kind: 'tool-call',
          status: 'completed',
          toolName: 'grep',
          data: { dir: 'packages/sync/src' },
          content:
            'keepalive.ts:58  socket.on("close", ...)\nsocket.ts:112  throw new SocketClose(...)',
        }),
        part({
          kind: 'tool-call',
          status: 'running',
          toolName: 'bash',
          data: { command: 'bun run check-types' },
        }),
        part({ kind: 'tool-call', status: 'pending', toolName: 'edit' }),
      ],
      text: '',
    },
  },
  {
    id: 'failed',
    title: 'Tool failure',
    note: 'A step that failed, with its output. The run carries on around it.',
    user: 'Run the suite.',
    segment: {
      live: false,
      parts: [
        part({
          kind: 'tool-call',
          status: 'completed',
          toolName: 'read',
          data: { path: 'packages/sync/test/keepalive.test.ts' },
        }),
        part({
          kind: 'tool-result',
          status: 'failed',
          toolName: 'bash',
          data: { command: 'bun test packages/sync' },
          content:
            'keepalive > retries a mid-flight close\n\n  expected: 2 attempts\n  received: 1 attempt\n\n  at packages/sync/test/keepalive.test.ts:41:7\n\n 1 fail, 24 pass',
        }),
      ],
      text: '',
    },
  },
  {
    id: 'mixed',
    title: 'Prose, then work, then prose',
    note: 'The shape most real turns take. Watch the rhythm between the three blocks.',
    user: 'Fix it and tell me what you changed.',
    segment: {
      live: false,
      parts: [
        part({
          kind: 'text',
          status: 'completed',
          content: 'Found it — the guard checks the code, which a mid-flight close never has.',
        }),
        part({
          kind: 'tool-call',
          status: 'completed',
          toolName: 'edit',
          data: { path: 'packages/sync/src/keepalive.ts' },
        }),
        part({
          kind: 'tool-result',
          status: 'completed',
          toolName: 'bash',
          data: { command: 'bun test packages/sync' },
          content: '25 pass, 0 fail',
        }),
        part({
          kind: 'text',
          status: 'completed',
          content:
            'Changed the guard to read `err.phase`. The suite passes, including the case that was failing.',
        }),
      ],
      text: '',
    },
  },
  {
    id: 'stress',
    title: 'Content that fights the layout',
    note: 'A long unbroken token, a wide table, and a deep code block. If anything is going to overflow, it is here.',
    user: 'https://example.com/a/very/long/url/that/will/not/break/anywhere/sensible/and/keeps/going/until/it/has/to/wrap?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    segment: {
      live: false,
      parts: [],
      text: `An unbroken identifier: \`ThisIsAVeryLongSymbolNameThatShouldWrapRatherThanPushTheBubbleWiderThanItsColumn\`

| Column | Another column | A third | Fourth | Fifth | Sixth | Seventh |
| --- | --- | --- | --- | --- | --- | --- |
| value | value | value | value | value | value | value |
| longer value here | longer value here | longer | longer | longer | longer | longer |

\`\`\`ts
const wide = { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5, zeta: 6, eta: 7, theta: 8 };
\`\`\``,
    },
  },
  {
    id: 'short',
    title: 'Short turns',
    note: 'Both sides brief. The bubble should not have more padding than content.',
    user: 'ok',
    segment: { live: false, parts: [], text: 'Done.' },
  },
] as const;

const PLAN = [
  {
    id: 'verify',
    label: 'Indexed consolidated texts',
    amount: '1 284 docs',
    status: 'done' as const,
    details: [
      { label: 'Matched BOE identifiers', meta: '1284/1284' },
      { label: 'Skipped superseded versions', meta: '37' },
    ],
  },
  {
    id: 'embed',
    label: 'Embed article bodies',
    amount: '96 412 chunks',
    status: 'running' as const,
    details: [
      { label: 'Reading consolidated XML', meta: '12 files' },
      { label: 'Batches written', meta: '68%' },
    ],
  },
  {
    id: 'links',
    label: 'Resolve cross-references',
    amount: '8 907 links',
    status: 'failed' as const,
    details: [
      { label: 'Unresolved target', meta: 'BOE-A-1978-31229' },
      { label: 'Retried', meta: '3×' },
    ],
  },
  {
    id: 'publish',
    label: 'Publish search index',
    status: 'pending' as const,
    details: [{ label: 'Waiting on cross-references' }],
  },
] as const;

const COMPOSERS = [
  { id: 'resting', running: false, error: null },
  { id: 'running', running: true, error: null },
  { id: 'error', running: false, error: 'Message send failed. The sync socket closed before it was written.' },
] as const;

/** A composer with its own draft, so each state can be typed into. */
function Composer(props: { error: string | null; running: boolean }) {
  const [value, setValue] = useState('');

  return (
    <AgentPrompt
      className="border-0 bg-transparent px-0 pb-0 pt-0 backdrop-blur-none"
      error={props.error}
      running={props.running}
      value={value}
      onCancel={() => {}}
      onSubmit={() => setValue('')}
      onValue={setValue}
    />
  );
}

function Gallery() {
  const [wide, setWide] = useState(false);

  return (
    <div className="h-svh overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-6 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <h1 className="text-sm font-medium">Conversation surfaces</h1>
            <p className="text-xs text-muted-foreground">
              Every shape a turn can take, rendered by the transcript's own components.
            </p>
          </div>

          <Button size="sm" variant="secondary" onClick={() => setWide((v) => !v)}>
            {wide ? 'Narrow column' : 'Wide column'}
          </Button>
        </div>
      </header>

      <main className={cn('mx-auto px-6 py-10', wide ? 'max-w-5xl' : 'max-w-3xl')}>
        <div className="space-y-14">
          {SCENES.map((scene) => (
            <section key={scene.id} className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-xs font-medium text-foreground">{scene.title}</h2>
                <p className="text-xs text-muted-foreground">{scene.note}</p>
              </div>

              <Separator />

              <div className="space-y-8 pt-2">
                <UserMessage content={scene.user} />
                {'pending' in scene ? (
                  <AssistantPending />
                ) : (
                  <AssistantMessage segment={{ ...scene.segment, parts: [...scene.segment.parts] }} />
                )}
              </div>
            </section>
          ))}

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xs font-medium text-foreground">Tool chips, every state</h2>
              <p className="text-xs text-muted-foreground">
                One run, with a call still out, one that failed, and one carrying nothing to open.
                Hover a row: the tool's mark trades places with the caret in the same slot, so
                nothing reflows.
              </p>
            </div>

            <Separator />

            <ToolChips
              steps={[
                { id: 't1', name: 'read', status: 'done', chip: 'packages/sync/src/keepalive.ts' },
                {
                  id: 't2',
                  name: 'grep',
                  status: 'done',
                  chip: 'SocketClose',
                  detail:
                    'keepalive.ts:58  socket.on("close", ...)\nsocket.ts:112  throw new SocketClose(...)',
                },
                {
                  id: 't3',
                  name: 'search_boe',
                  status: 'done',
                  chip: 'disposiciones sobre contratación pública de 2024',
                  mono: false,
                  detail: '14 disposiciones · BOE-A-2024-1234 … BOE-A-2024-9981',
                },
                {
                  id: 't4',
                  name: 'bash',
                  status: 'failed',
                  chip: 'bun test packages/sync',
                  detail:
                    'keepalive > retries a mid-flight close\n\n  expected: 2 attempts\n  received: 1 attempt\n\n  at packages/sync/test/keepalive.test.ts:41:7\n\n 1 fail, 24 pass',
                },
                {
                  id: 't5',
                  name: 'edit',
                  status: 'running',
                  chip: 'packages/sync/src/keepalive.ts',
                },
                { id: 't6', name: 'write_report', status: 'pending' },
              ]}
            />
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xs font-medium text-foreground">Task rows, capsules</h2>
              <p className="text-xs text-muted-foreground">
                A plan rather than a tool log. Each capsule flattens as it opens; the failed row
                opens itself.
              </p>
            </div>

            <Separator />

            <TaskRows rows={PLAN} />
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xs font-medium text-foreground">Composer</h2>
              <p className="text-xs text-muted-foreground">
                Live instances, one per state. Type in the first; the second is mid-run, so its
                action is stop; the third carries a send error.
              </p>
            </div>

            <Separator />

            <div className="space-y-6">
              {COMPOSERS.map((props) => (
                <Composer key={props.id} {...props} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xs font-medium text-foreground">Task rows, list</h2>
              <p className="text-xs text-muted-foreground">
                The same plan as one card. For a list long enough that eight separate shadows stops
                reading as eight steps and starts reading as noise.
              </p>
            </div>

            <Separator />

            <TaskRows rows={PLAN} variant="list" />
          </section>
        </div>
      </main>
    </div>
  );
}
