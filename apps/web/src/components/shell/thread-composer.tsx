import { CycleIcon, MagnifyingGlassIcon, PlusIcon } from '~/components/icons';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

function ThreadComposer(props: {
  debug: boolean;
  disabled: boolean;
  onCreate: () => void;
  onCycle: () => void;
  onQuery: (query: string) => void;
  onTitle: (title: string) => void;
  query: string;
  title: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="relative">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />

        <Input
          aria-label="Search conversations"
          autoComplete="off"
          className="h-9 rounded-(--radius-control) border-line bg-surface/80 pl-9 pr-3 text-sm"
          placeholder="Search threads"
          spellCheck={false}
          type="search"
          value={props.query}
          onChange={(event) => props.onQuery(event.currentTarget.value)}
        />
      </div>

      <form
        className="grid grid-cols-[1fr_auto_auto] gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          props.onCreate();
        }}
      >
        <Input
          aria-label="New thread title"
          autoComplete="off"
          className="h-9 rounded-(--radius-control) border-line bg-surface/80 text-sm"
          placeholder="New thread"
          value={props.title}
          onChange={(event) => props.onTitle(event.currentTarget.value)}
        />

        <Button
          aria-label="Create thread"
          className="size-9 rounded-(--radius-press)"
          size="icon"
          type="submit"
        >
          <PlusIcon weight="regular" />
        </Button>

        <Button
          aria-label="Debug cycle threads"
          className={cn('size-9 rounded-(--radius-press)', props.debug && 'animate-pulse')}
          disabled={props.debug || props.disabled}
          size="icon"
          type="button"
          variant="secondary"
          onClick={props.onCycle}
        >
          <CycleIcon />
        </Button>
      </form>
    </div>
  );
}

export { ThreadComposer };
