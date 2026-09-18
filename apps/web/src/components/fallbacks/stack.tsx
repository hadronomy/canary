import { useCallback, useMemo, useState } from 'react';

import { Check, Fade } from '~/components/login/bits';

type Frame = {
  fn: string;
  file: string;
  at: string;
  /** False for anything under node_modules or a bundler chunk. */
  own: boolean;
  /** Path Vite's dev server will open, when this frame is ours. */
  open: string | null;
};

// V8: `    at fn (file:line:col)` or `    at file:line:col`.
const V8 = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
// Firefox / Safari: `fn@file:line:col`.
const SPIDER = /^(.*?)@(.+?):(\d+):(\d+)$/;

const VENDOR = /node_modules|react-dom|react-refresh|\/@(?:fs|id|vite)\/|chunk-[A-Z0-9]/;

/**
 * Pull frames out of a stack string.
 *
 * Deliberately forgiving: a stack is a string with no contract, and a fallback
 * that throws while formatting another failure is the worst outcome available.
 * Anything unparseable is kept as part of the message rather than dropped.
 */
function parse(stack: string) {
  const head: string[] = [];
  const frames: Frame[] = [];

  for (const line of stack.split('\n')) {
    const hit = V8.exec(line) ?? SPIDER.exec(line);
    if (!hit) {
      if (frames.length === 0 && line.trim()) head.push(line.trim());
      continue;
    }

    const [, fn, file = '', row, col] = hit;
    const own = !VENDOR.test(file);
    // Vite's editor bridge wants a project-relative path.
    const rel = file.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '');

    frames.push({
      fn: fn?.trim() || '(anonymous)',
      file: rel.split('/').pop() ?? rel,
      at: `${row}:${col}`,
      own,
      open: own && import.meta.env.DEV ? `${rel}:${row}:${col}` : null,
    });
  }

  return { message: head.join('\n'), frames };
}

/**
 * The stack, as something you can actually use.
 *
 * Frames from the app are legible and, in dev, open in the editor on click.
 * Everything from a dependency folds away behind one line — a React stack is
 * mostly internals, and burying the two frames that matter under forty that do
 * not is the reason nobody reads these.
 */
function Stack({ trace }: { trace: string }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const { message, frames } = useMemo(() => parse(trace), [trace]);
  const own = frames.filter((f) => f.own);
  const hidden = frames.length - own.length;
  const shown = all ? frames : own;

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(trace).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [trace]);

  if (!trace) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="stack-body"
          className="code flex items-center gap-2 text-[11px] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]"
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            className="size-3 transition-transform duration-[250ms] ease-[var(--ease-strong)] motion-reduce:transition-none"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          >
            <path
              d="M4.5 2.5 8 6l-3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          stack
          <span className="text-[var(--text-faint)]">{frames.length}</span>
        </button>

        <button
          type="button"
          onClick={copy}
          className="code grid text-[11px] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]"
        >
          <span className="grid [grid-area:1/1] items-center justify-items-start">
            <Fade show={!copied}>copy</Fade>
          </span>
          <span className="grid [grid-area:1/1] items-center justify-items-start">
            <Fade show={copied}>
              <span className="flex items-center gap-1.5 text-[var(--text)]">
                <Check className="size-3" />
                copied
              </span>
            </Fade>
          </span>
        </button>
      </div>

      <div id="stack-body" className="t-grow" data-open={open} inert={!open}>
        <div>
          <div className="pt-4">
            {message ? (
              <p className="code mb-3 break-words text-[11px] leading-relaxed text-[var(--bad)]">
                {message}
              </p>
            ) : null}

            <ol className="flex flex-col">
              {shown.map((f, i) => (
                <Row key={`${f.file}-${f.at}-${i}`} frame={f} index={i} />
              ))}
            </ol>

            {hidden > 0 ? (
              <button
                type="button"
                onClick={() => setAll((a) => !a)}
                className="code mt-2 px-2 text-[11px] text-[var(--text-faint)] transition-colors duration-150 hover:text-[var(--text-dim)]"
              >
                {all ? 'hide dependency frames' : `${hidden} more from dependencies`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ frame, index }: { frame: Frame; index: number }) {
  const inner = (
    <>
      <span
        className="min-w-0 truncate"
        style={{ color: frame.own ? 'var(--text)' : 'var(--text-faint)' }}
      >
        {frame.fn}
      </span>
      <span className="shrink-0 text-[var(--text-faint)] transition-colors duration-150 group-hover/r:text-[var(--text-dim)]">
        {frame.file}:{frame.at}
      </span>
    </>
  );

  const className =
    'code group/r flex w-full items-baseline justify-between gap-6 rounded-[3px] px-2 py-1.5 text-left text-[11px] transition-colors duration-150 hover:bg-[rgb(233_235_236/0.05)]';

  return (
    <li
      // Frames land in the order you read them rather than all at once.
      style={{ animation: `stack-in 260ms var(--ease-strong) ${Math.min(index, 8) * 28}ms both` }}
    >
      {frame.open ? (
        <a href={`/__open-in-editor?file=${encodeURIComponent(frame.open)}`} className={className}>
          {inner}
        </a>
      ) : (
        <span className={className}>{inner}</span>
      )}
    </li>
  );
}

export { Stack };
