import {
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type ReactNode,
  useId,
} from 'react';

import { CycleIcon, MagnifyingGlassIcon, PlusIcon } from '~/components/icons';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

type ThreadComposerProps = Omit<ComponentPropsWithoutRef<'section'>, 'children'> & {
  debug: boolean;
  disabled?: boolean;
  onCreate: () => void;
  onCycle: () => void;
  onQuery: (query: string) => void;
  onTitle: (title: string) => void;
  query: string;
  title: string;
};

function ThreadComposer({
  className,
  debug,
  disabled = false,
  onCreate,
  onCycle,
  onQuery,
  onTitle,
  query,
  title,
  ...props
}: ThreadComposerProps) {
  const searchId = useId();
  const titleId = useId();

  return (
    <section
      aria-label="Thread actions"
      className={cn('grid gap-2', className)}
      data-thread-composer=""
      {...props}
    >
      <ThreadSearchField id={searchId} value={query} onValueChange={onQuery} />

      <NewThreadForm
        debug={debug}
        disabled={disabled}
        title={title}
        titleId={titleId}
        onCreate={onCreate}
        onCycle={onCycle}
        onTitleChange={onTitle}
      />
    </section>
  );
}

type ThreadSearchFieldProps = Omit<
  ComponentPropsWithoutRef<'form'>,
  'children' | 'onChange' | 'onSubmit'
> & {
  id?: string;
  onValueChange: (value: string) => void;
  value: string;
};

function ThreadSearchField({
  className,
  id,
  onValueChange,
  value,
  ...props
}: ThreadSearchFieldProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onValueChange(event.currentTarget.value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <form
      role="search"
      className={cn('relative', className)}
      data-thread-search=""
      onSubmit={handleSubmit}
      {...props}
    >
      <label className="sr-only" htmlFor={inputId}>
        Search conversations
      </label>

      <MagnifyingGlassIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />

      <Input
        id={inputId}
        autoComplete="off"
        className="h-9 rounded-(--radius-control) border-line bg-surface/80 pl-9 pr-3 text-sm"
        placeholder="Search threads"
        spellCheck={false}
        type="search"
        value={value}
        onChange={handleChange}
      />
    </form>
  );
}

type NewThreadFormProps = Omit<ComponentPropsWithoutRef<'form'>, 'children' | 'onSubmit'> & {
  debug: boolean;
  disabled?: boolean;
  onCreate: () => void;
  onCycle: () => void;
  onTitleChange: (title: string) => void;
  title: string;
  titleId?: string;
};

function NewThreadForm({
  className,
  debug,
  disabled = false,
  onCreate,
  onCycle,
  onTitleChange,
  title,
  titleId,
  ...props
}: NewThreadFormProps) {
  const fallbackTitleId = useId();
  const inputId = titleId ?? fallbackTitleId;

  const createDisabled = disabled;
  const cycleDisabled = disabled || debug;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (createDisabled) {
      return;
    }

    onCreate();
  }

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    onTitleChange(event.currentTarget.value);
  }

  return (
    <form
      className={cn('grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2', className)}
      data-new-thread-form=""
      onSubmit={handleSubmit}
      {...props}
    >
      <label className="sr-only" htmlFor={inputId}>
        New thread title
      </label>

      <Input
        id={inputId}
        autoComplete="off"
        className="h-9 rounded-(--radius-control) border-line bg-surface/80 text-sm"
        disabled={disabled}
        placeholder="New thread"
        value={title}
        onChange={handleTitleChange}
      />

      <IconButton
        aria-label="Create thread"
        disabled={createDisabled}
        icon={<PlusIcon aria-hidden="true" weight="regular" />}
        type="submit"
      />

      <CycleThreadsButton debug={debug} disabled={cycleDisabled} onCycle={onCycle} />
    </form>
  );
}

type IconButtonProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'children' | 'size'> & {
  icon: ReactNode;
};

function IconButton({ className, icon, ...props }: IconButtonProps) {
  return (
    <Button className={cn('size-9 rounded-(--radius-press)', className)} size="icon" {...props}>
      {icon}
    </Button>
  );
}

type CycleThreadsButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'children' | 'disabled' | 'onClick' | 'size' | 'type' | 'variant'
> & {
  debug: boolean;
  disabled?: boolean;
  onCycle: () => void;
};

function CycleThreadsButton({
  className,
  debug,
  disabled = false,
  onCycle,
  ...props
}: CycleThreadsButtonProps) {
  return (
    <Button
      aria-label={debug ? 'Cycling threads' : 'Debug cycle threads'}
      aria-busy={debug || undefined}
      className={cn('size-9 rounded-(--radius-press)', debug && 'animate-pulse', className)}
      disabled={disabled}
      size="icon"
      type="button"
      variant="secondary"
      onClick={onCycle}
      {...props}
    >
      <CycleIcon aria-hidden="true" />
    </Button>
  );
}

export { CycleThreadsButton, NewThreadForm, ThreadComposer, ThreadSearchField };

export type {
  CycleThreadsButtonProps,
  NewThreadFormProps,
  ThreadComposerProps,
  ThreadSearchFieldProps,
};
