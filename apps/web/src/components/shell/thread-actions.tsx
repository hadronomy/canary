import {
  ArrowsClockwiseIcon as CycleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import {
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type ReactNode,
  useId,
} from 'react';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';

type ThreadActionsProps = Omit<ComponentPropsWithoutRef<'section'>, 'children'> & {
  createDisabled?: boolean;
  cycleDisabled?: boolean;
  debug: boolean;
  disabled?: boolean;
  onCreate: () => void;
  onCycle: () => void;
  onQuery: (query: string) => void;
  onTitle: (title: string) => void;
  query: string;
  title: string;
};

function ThreadActions({
  className,
  createDisabled = false,
  cycleDisabled = false,
  debug,
  disabled = false,
  onCreate,
  onCycle,
  onQuery,
  onTitle,
  query,
  title,
  ...props
}: ThreadActionsProps) {
  const searchId = useId();
  const titleId = useId();

  return (
    <section
      aria-label="Thread actions"
      className={cn('grid gap-2', className)}
      data-thread-actions=""
      {...props}
    >
      <ThreadSearch id={searchId} value={query} onValueChange={onQuery} />

      <ThreadCreateForm
        createDisabled={createDisabled || disabled}
        cycleDisabled={cycleDisabled || disabled}
        debug={debug}
        title={title}
        titleId={titleId}
        onCreate={onCreate}
        onCycle={onCycle}
        onTitleChange={onTitle}
      />
    </section>
  );
}

type ThreadSearchProps = Omit<
  ComponentPropsWithoutRef<'form'>,
  'children' | 'onChange' | 'onSubmit'
> & {
  id?: string;
  onValueChange: (value: string) => void;
  value: string;
};

function ThreadSearch({ className, id, onValueChange, value, ...props }: ThreadSearchProps) {
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

      <Elevated
        shadowLevel={1}
        className="rounded-(--radius-control) border border-input/70 transition-[border-color,box-shadow] duration-150 ease-out-strong focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/20"
      >
        <InputGroup className="h-9 border-0 bg-transparent dark:bg-transparent">
          <InputGroupAddon>
            <MagnifyingGlassIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id={inputId}
            autoComplete="off"
            className="text-sm"
            placeholder="Search threads"
            spellCheck={false}
            type="search"
            value={value}
            onChange={handleChange}
          />
        </InputGroup>
      </Elevated>
    </form>
  );
}

type ThreadCreateFormProps = Omit<ComponentPropsWithoutRef<'form'>, 'children' | 'onSubmit'> & {
  createDisabled?: boolean;
  cycleDisabled?: boolean;
  debug: boolean;
  disabled?: boolean;
  onCreate: () => void;
  onCycle: () => void;
  onTitleChange: (title: string) => void;
  title: string;
  titleId?: string;
};

function ThreadCreateForm({
  className,
  createDisabled = false,
  cycleDisabled = false,
  debug,
  disabled = false,
  onCreate,
  onCycle,
  onTitleChange,
  title,
  titleId,
  ...props
}: ThreadCreateFormProps) {
  const fallbackTitleId = useId();
  const inputId = titleId ?? fallbackTitleId;

  const createBlocked = disabled || createDisabled;
  const cycleBlocked = disabled || cycleDisabled || debug;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (createBlocked) {
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

      <Elevated
        shadowLevel={1}
        className={cn(
          'min-w-0 rounded-(--radius-control) border border-input/70 transition-[border-color,box-shadow] duration-150 ease-out-strong focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/20',
          createBlocked && 'opacity-50',
        )}
      >
        <Input
          id={inputId}
          autoComplete="off"
          className="h-9 border-0 bg-transparent text-sm focus-visible:ring-0 dark:bg-transparent"
          disabled={createBlocked}
          placeholder="New thread"
          value={title}
          onChange={handleTitleChange}
        />
      </Elevated>

      <IconButton
        aria-label="Create thread"
        disabled={createBlocked}
        icon={<PlusIcon aria-hidden="true" weight="regular" />}
        type="submit"
      />

      <ThreadCycleButton debug={debug} disabled={cycleBlocked} onCycle={onCycle} />
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

type ThreadCycleButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'children' | 'disabled' | 'onClick' | 'size' | 'type' | 'variant'
> & {
  debug: boolean;
  disabled?: boolean;
  onCycle: () => void;
};

function ThreadCycleButton({
  className,
  debug,
  disabled = false,
  onCycle,
  ...props
}: ThreadCycleButtonProps) {
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

export { ThreadCycleButton, ThreadCreateForm, ThreadActions, ThreadSearch };

export type {
  ThreadCycleButtonProps,
  ThreadCreateFormProps,
  ThreadActionsProps,
  ThreadSearchProps,
};
