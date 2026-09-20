import type { ComponentPropsWithoutRef } from 'react';

import { code } from '@streamdown/code';
import { memo, useState } from 'react';
import { Streamdown } from 'streamdown';

import type { Part } from '@canary/sync';
import type { Task, TaskStatus } from '~/components/agent/task-list';

import { TaskGroup, TaskList } from '~/components/agent/task-list';
import { Bubble, BubbleContent } from '~/components/ui/bubble';
import { Message, MessageContent } from '~/components/ui/message';
import { cn } from '~/lib/utils';

/**
 * Everything a turn is made of, as pure functions of its parts.
 *
 * Split out of the transcript route so the same components draw the real
 * conversation and the gallery at `/design/chat`. A gallery that rebuilt the
 * markup would only ever prove that the copy of it looked right.
 *
 * Nothing here knows about the virtualiser, the run machine or the scroll
 * anchoring — a part goes in, a rendering comes out.
 */

/** One assistant reply: its text, its parts, and whether it is still arriving. */
type Segment = {
  live: boolean;
  parts: Part[];
  text: string;
};

function UserMessage({ content }: { content: string }) {
  return (
    <Message align="end" className="px-0">
      <MessageContent className="max-w-[min(80%,44rem)]">
        <Bubble align="end" className="max-w-none" variant="secondary">
          <BubbleContent>
            <Markdown text={content} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function AssistantMessage({ segment }: { segment: Segment }) {
  return (
    <Message align="start" className="px-0">
      <MessageContent className="w-full min-w-0">
        <Bubble className="w-full max-w-none" variant="ghost">
          <BubbleContent className="w-full max-w-none p-0">
            <AssistantTurn segment={segment} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function AssistantTurn({ segment }: { segment: Segment }) {
  if (!segment.parts.length) {
    return (
      <div className="flow-root min-w-0 max-w-full">
        <Markdown live={segment.live} text={segment.text} />
      </div>
    );
  }

  return (
    <div className="flow-root min-w-0 max-w-full space-y-3">
      {runsOf(segment.parts).map((run) =>
        run.kind === 'tasks' ? (
          <TaskGroup key={run.id}>
            {/* `revealed` is the whole group: a step appears when its event
                lands, not on a timer. A timer would keep resizing the turn
                after the run had already finished, and the transcript's scroll
                anchoring measures every one of those frames. */}
            <TaskList revealed={run.parts.length} tasks={run.parts.map(asTask)} />
          </TaskGroup>
        ) : (
          <AssistantPart
            key={run.parts[0]?.id}
            live={run.parts[0]?.status === 'running'}
            part={run.parts[0] as Part}
          />
        ),
      )}
    </div>
  );
}

function AssistantPart({ live, part }: { live?: boolean; part: Part }) {
  if (part.kind === 'text') {
    return <Markdown live={live} text={partContent(part)} />;
  }

  return <ReasoningPart live={live} part={part} />;
}

type DisclosureProps = Omit<ComponentPropsWithoutRef<'details'>, 'open'> & {
  defaultOpen?: boolean;
  forceOpen?: boolean;
};

function Disclosure({
  children,
  defaultOpen = false,
  forceOpen = false,
  onToggle,
  ...props
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      {...props}
      open={forceOpen || open}
      onToggle={(event) => {
        onToggle?.(event);

        if (forceOpen || event.defaultPrevented) {
          return;
        }

        setOpen(event.currentTarget.open);
      }}
    >
      {children}
    </details>
  );
}

function ReasoningPart({ live, part }: { live?: boolean; part: Part }) {
  const running = part.status === 'running';

  return (
    <Disclosure
      className="flow-root min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/80 p-3 text-xs shadow-surface-1"
      defaultOpen={running}
      forceOpen={running}
    >
      <summary className="cursor-pointer text-muted-foreground">Reasoning</summary>
      <Markdown live={live} text={partContent(part)} />
    </Disclosure>
  );
}

const Markdown = memo(function Markdown(props: {
  className?: string;
  live?: boolean;
  text: string;
}) {
  return (
    <Streamdown
      className={cn('canary-markdown', props.className)}
      mode={props.live ? 'streaming' : 'static'}
      plugins={{ code }}
    >
      {props.text}
    </Streamdown>
  );
});

type PartRun =
  | { id: string; kind: 'tasks'; parts: Part[] }
  | { id: string; kind: 'prose'; parts: Part[] };

/**
 * Split a turn's parts into prose and stretches of tool work.
 *
 * Consecutive tool parts become one log instead of a stack of separate
 * disclosures — a run that touched nine files was reading as nine unrelated
 * panels rather than as one piece of work.
 */
function runsOf(parts: readonly Part[]): PartRun[] {
  const runs: PartRun[] = [];

  for (const part of parts) {
    const kind = part.kind === 'text' || part.kind === 'reasoning' ? 'prose' : 'tasks';
    const tail = runs.at(-1);

    if (kind === 'tasks' && tail?.kind === 'tasks') {
      tail.parts.push(part);
      continue;
    }

    runs.push({ id: part.id, kind, parts: [part] });
  }

  return runs;
}

function asTask(part: Part): Task {
  const body = structuredPartBody(part);

  return {
    detail: body || undefined,
    id: part.id,
    label: structuredPartTitle(part),
    resources: resourcesOf(part),
    status: taskStatus(part.status),
  };
}

function taskStatus(status: Part['status']): TaskStatus {
  if (status === 'running') {
    return 'running';
  }

  if (status === 'completed') {
    return 'done';
  }

  if (status === 'failed' || status === 'cancelled') {
    return 'failed';
  }

  return 'pending';
}

// Tool arguments are free-form, so this reads the few keys that conventionally
// carry a path and ignores everything else rather than guessing at the shape.
function resourcesOf(part: Part) {
  const data = 'data' in part && part.data && typeof part.data === 'object' ? part.data : null;

  if (!data) {
    return undefined;
  }

  const paths = ['path', 'file', 'filePath', 'file_path', 'dir', 'directory', 'command']
    .map((key) => [key, (data as Record<string, unknown>)[key]] as const)
    .filter(
      (entry): entry is readonly [string, string] => typeof entry[1] === 'string' && !!entry[1],
    )
    .map(([key, value]) => ({
      kind:
        key === 'command'
          ? ('command' as const)
          : key.startsWith('dir')
            ? ('dir' as const)
            : ('file' as const),
      name: value,
    }));

  return paths.length ? paths : undefined;
}

function structuredPartTitle(part: Part) {
  if ('toolName' in part && typeof part.toolName === 'string' && part.toolName.trim()) {
    return part.toolName;
  }

  if (part.kind === 'tool-call') {
    return 'tool call';
  }

  if (part.kind === 'tool-result') {
    return 'tool result';
  }

  return part.kind;
}

function structuredPartBody(part: Part) {
  const content = partContent(part).trim();

  if (content) {
    return content;
  }

  const data = 'data' in part ? part.data : undefined;

  if (data === undefined || data === null) {
    return '';
  }

  return JSON.stringify(data, null, 2) ?? String(data);
}

function partContent(part: Part) {
  return 'content' in part && typeof part.content === 'string' ? part.content : '';
}

export {
  AssistantMessage,
  AssistantPart,
  AssistantTurn,
  Disclosure,
  Markdown,
  ReasoningPart,
  UserMessage,
  asTask,
  partContent,
  runsOf,
  structuredPartBody,
  structuredPartTitle,
  taskStatus,
};
export type { Segment };
