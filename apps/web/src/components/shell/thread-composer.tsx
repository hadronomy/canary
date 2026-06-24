import { CycleIcon, PlusIcon } from '~/components/icons';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

function ThreadComposer(props: {
  debug: boolean;
  disabled: boolean;
  onCreate: () => void;
  onCycle: () => void;
  onTitle: (title: string) => void;
  title: string;
}) {
  return (
    <form
      className="grid grid-cols-[1fr_auto_auto] gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        props.onCreate();
      }}
    >
      <Input
        className="h-10 rounded-[var(--radius-control)] border-white/10 bg-black/20 text-sm"
        value={props.title}
        placeholder="New thread"
        onChange={(event) => props.onTitle(event.currentTarget.value)}
      />
      <Button
        aria-label="Create thread"
        className="rounded-[var(--radius-press)]"
        size="icon"
        type="submit"
      >
        <PlusIcon weight="regular" />
      </Button>
      <Button
        aria-label="Debug cycle threads"
        className="rounded-[var(--radius-press)]"
        disabled={props.debug || props.disabled}
        size="icon"
        type="button"
        variant="secondary"
        onClick={props.onCycle}
      >
        <CycleIcon />
      </Button>
    </form>
  );
}

export { ThreadComposer };
