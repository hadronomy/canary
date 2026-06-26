import type { RegisterableHotkey } from '@tanstack/react-hotkeys';

import { formatForDisplay } from '@tanstack/react-hotkeys';

import { CommandIcon } from '~/components/icons';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { cn } from '~/lib/utils';

function ComposerShortcut(props: {
  className?: string;
  kbdClassName?: string;
  value: RegisterableHotkey;
}) {
  const parts = shortcutParts(props.value);

  if (!parts.length) {
    return null;
  }

  return (
    <KbdGroup className={cn('gap-1', props.className)} title={shortcutLabel(props.value)}>
      {parts.map((part, index) => (
        <Kbd key={`${part}-${index}`} className={props.kbdClassName}>
          <Keycap value={part} />
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function Keycap(props: { value: string }) {
  const key = props.value.trim();
  const lower = key.toLowerCase();

  if (key === '⌘' || lower === 'cmd' || lower === 'command' || lower === 'meta') {
    return (
      <>
        <span className="sr-only">Command</span>
        <CommandIcon aria-hidden className="size-3" />
      </>
    );
  }

  if (key === '⇧') {
    return (
      <>
        <span className="sr-only">Shift</span>
        <span aria-hidden>⇧</span>
      </>
    );
  }

  if (key === '⌥') {
    return (
      <>
        <span className="sr-only">Option</span>
        <span aria-hidden>⌥</span>
      </>
    );
  }

  if (key === '⌃') {
    return (
      <>
        <span className="sr-only">Control</span>
        <span aria-hidden>⌃</span>
      </>
    );
  }

  return <span>{key}</span>;
}

function shortcutParts(value: RegisterableHotkey) {
  return shortcutLabel(value)
    .split(/\s*\+\s*|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function shortcutLabel(value: RegisterableHotkey) {
  return formatForDisplay(value, { separatorToken: ' ' });
}

export { ComposerShortcut, shortcutLabel };
