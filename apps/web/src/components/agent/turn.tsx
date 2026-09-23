import { CheckIcon, CopyIcon, type IconProps } from '@phosphor-icons/react';
import { createCodePlugin } from '@streamdown/code';
import { memo } from 'react';
import { Streamdown, type LinkSafetyModalProps } from 'streamdown';

import type { Part } from '@canary/sync';
import type { ToolState, ToolStep } from '~/components/agent/tool-chips';

import { Copy } from '~/components/agent/copy';
import { LinkDialog } from '~/components/agent/link-dialog';
import { Reasoning, Thinking } from '~/components/agent/reasoning';
import { ToolChips } from '~/components/agent/tool-chips';
import { Bubble, BubbleContent } from '~/components/ui/bubble';
import { Message, MessageContent, MessageFooter } from '~/components/ui/message';
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

// Actions show on hover or focus rather than under every turn at once, where a
// column of identical icons turns the transcript into a form. Touch has no
// hover to reveal them with, so there they are always on.
const HOVER_ONLY =
  'opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100';

function UserMessage({ content }: { content: string }) {
  return (
    <Message align="end" className="items-end px-0">
      <MessageContent className="w-fit max-w-[min(80%,44rem)]">
        <Bubble align="end" className="max-w-none" variant="secondary">
          <BubbleContent>
            <Markdown text={content} />
          </BubbleContent>
        </Bubble>
      </MessageContent>

      <Copy className={HOVER_ONLY} label="Copy message" text={content} />
    </Message>
  );
}

function AssistantMessage({ segment }: { segment: Segment }) {
  const text = textOf(segment);

  return (
    <Message align="start" className="px-0">
      <MessageContent className="w-full min-w-0 gap-1.5">
        <Bubble className="w-full max-w-none" variant="ghost">
          <BubbleContent className="w-full max-w-none p-0">
            <AssistantTurn segment={segment} />
          </BubbleContent>
        </Bubble>

        {/* Nothing to act on until the reply has settled. The row is pulled
            left by the button's own inset so the icon, not its hit area,
            lines up with the text above it. */}
        {!segment.live && text ? (
          <MessageFooter className={cn('-ml-1.5', HOVER_ONLY)}>
            <Copy label="Copy reply" text={text} />
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

/**
 * A run that has started and not yet said anything.
 *
 * Without this the transcript shows your message and then nothing, and the
 * only sign that anything is happening is a label down in the composer.
 */
function AssistantPending() {
  return (
    <Message align="start" className="px-0">
      <Thinking />
    </Message>
  );
}

/** What a reply says, as plain markdown, for the clipboard. */
function textOf(segment: Segment) {
  if (!segment.parts.length) {
    return segment.text.trim();
  }

  return segment.parts
    .filter((part) => part.kind === 'text')
    .map((part) => partContent(part).trim())
    .filter(Boolean)
    .join('\n\n');
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
          /* One group per stretch of tool work, and no timed reveal: a step
             appears when its event lands. A timer would keep resizing the turn
             after the run had already finished, and the transcript's scroll
             anchoring measures every one of those frames. */
          <ToolChips key={run.id} steps={run.parts.map(asStep)} />
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

function ReasoningPart({ live, part }: { live?: boolean; part: Part }) {
  return (
    <Reasoning duration={secondsOf(part)} running={part.status === 'running'}>
      <Markdown className="canary-trace" live={live} text={partContent(part)} />
    </Reasoning>
  );
}

/**
 * How long the model spent on this part.
 *
 * Both stamps are real: the row is created when the first token of the trace
 * lands and touched on every one after, so the gap between them is the time
 * the model actually spent, not the time the turn took.
 */
function secondsOf(part: Part) {
  if (part.status === 'running' || !part.createdAt || !part.updatedAt) {
    return undefined;
  }

  return (part.updatedAt.getTime() - part.createdAt.getTime()) / 1000;
}

// Vitesse over the default GitHub pair: its keywords are a muted teal rather
// than a saturated red, so a listing sits in the answer instead of shouting
// over it.
const highlighter = createCodePlugin({ themes: ['vitesse-light', 'vitesse-dark'] });

// Copy only. A snippet is pasted far more often than it is saved, and a
// fullscreen table in a chat column is a modal for four rows.
const CONTROLS = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
} as const;

const ICONS = {
  CopyIcon: (props: IconProps) => <CopyIcon {...props} size={15} />,
  CheckIcon: (props: IconProps) => (
    <CheckIcon {...props} className="text-success" size={15} weight="bold" />
  ),
};

const SAFETY = {
  enabled: true,
  renderModal: (props: LinkSafetyModalProps) => <LinkDialog {...props} />,
};

// Words resolve out of a short blur as they land, which is what keeps a fast
// stream from reading as text flickering into place. Only new words animate;
// what is already on screen is never replayed.
const REVEAL = {
  animation: 'blurIn',
  duration: 260,
  easing: 'var(--ease-out-strong)',
  sep: 'word',
} as const;

const Markdown = memo(function Markdown(props: {
  className?: string;
  live?: boolean;
  text: string;
}) {
  return (
    <Streamdown
      animated={REVEAL}
      caret={props.live ? 'block' : undefined}
      className={cn('canary-markdown', props.className)}
      controls={CONTROLS}
      icons={ICONS}
      isAnimating={props.live}
      linkSafety={SAFETY}
      mode={props.live ? 'streaming' : 'static'}
      plugins={{ code: highlighter }}
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

function asStep(part: Part): ToolStep {
  const arg = argOf(part);

  return {
    chip: arg?.value,
    detail: echoes(part) ? undefined : structuredPartBody(part),
    id: part.id,
    mono: arg?.mono ?? true,
    name: structuredPartTitle(part),
    status: toolState(part),
  };
}

/**
 * Whether the only thing to open is the argument the chip already shows.
 *
 * A call with no output yet falls back to printing its arguments, and for a
 * `read` of one path that is the path again, wrapped in braces. The row would
 * offer a caret that opens onto nothing new.
 */
function echoes(part: Part) {
  const data = fields(part);

  if (partContent(part).trim() || !data || 'result' in data) {
    return false;
  }

  const args = data.args && typeof data.args === 'object' ? (data.args as Fields) : data;
  return Object.keys(args).length <= 1;
}

/**
 * The status a tool row should read as.
 *
 * A result carrying `isError` arrives with a `completed` status, because the
 * call itself did complete — the tool ran and came back. What came back was a
 * failure, and that is the thing a person is scanning the log for, so it is
 * what the row reports.
 */
function toolState(part: Part): ToolState {
  const data = fields(part);

  if (part.status === 'failed' || part.status === 'cancelled' || data?.isError === true) {
    return 'failed';
  }

  if (part.status === 'running') {
    return 'running';
  }

  if (part.status === 'completed') {
    return 'done';
  }

  return 'pending';
}

// Tool arguments are free-form, so this reads the few keys that conventionally
// carry the one value worth showing inline and ignores the rest rather than
// guessing at the shape. Prose keys come last and turn mono off, because a
// sentence set in mono reads as output rather than as something written.
const KEYS = [
  ['command', true],
  ['path', true],
  ['file', true],
  ['filePath', true],
  ['file_path', true],
  ['dir', true],
  ['directory', true],
  ['url', true],
  ['pattern', true],
  ['query', false],
  ['prompt', false],
] as const;

function argOf(part: Part) {
  const data = fields(part);
  const args = data?.args && typeof data.args === 'object' ? (data.args as Fields) : data;

  if (!args) {
    return undefined;
  }

  for (const [key, mono] of KEYS) {
    const value = args[key];

    if (typeof value === 'string' && value.trim()) {
      return { mono, value: value.trim() };
    }
  }

  return undefined;
}

type Fields = Record<string, unknown>;

function fields(part: Part): Fields | null {
  return 'data' in part && part.data && typeof part.data === 'object'
    ? (part.data as Fields)
    : null;
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

/**
 * What a tool actually returned, as text.
 *
 * A result part wraps its payload in `{ result, isError }`, so the wrapper is
 * unwrapped first — printing it whole buries three lines of output under two
 * lines of bookkeeping the reader already knows.
 */
function structuredPartBody(part: Part) {
  const content = partContent(part).trim();

  if (content) {
    return content;
  }

  const data = fields(part);

  if (!data) {
    return '';
  }

  const body = 'result' in data ? data.result : 'args' in data ? data.args : data;

  if (body === undefined || body === null || body === '') {
    return '';
  }

  return typeof body === 'string' ? body.trim() : (JSON.stringify(body, null, 2) ?? String(body));
}

function partContent(part: Part) {
  return 'content' in part && typeof part.content === 'string' ? part.content : '';
}

export {
  AssistantMessage,
  AssistantPending,
  AssistantPart,
  AssistantTurn,
  Markdown,
  ReasoningPart,
  UserMessage,
  asStep,
  partContent,
  runsOf,
  structuredPartBody,
  structuredPartTitle,
  textOf,
  toolState,
};
export type { Segment };
