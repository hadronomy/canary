import { CommandIcon, MagnifyingGlassIcon } from '~/components/icons';
import { Input } from '~/components/ui/input';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { cn } from '~/lib/utils';

const key =
  'size-6 min-w-6 rounded-[0.6rem] border border-white/10 bg-white/[0.045] p-0 text-[13px] font-medium text-foreground/75 shadow-[inset_0_1px_0_oklch(1_0_0_/_8%),0_1px_2px_oklch(0_0_0_/_20%)]';

function SearchBox(props: { open?: boolean }) {
  const open = props.open ?? true;

  return (
    <div
      className={cn(
        'relative h-10 w-full min-w-0 overflow-hidden rounded-[0.8rem] border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_oklch(1_0_0_/_5%)] transition-[border-color,background-color,box-shadow] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none',
      )}
      title={open ? undefined : 'Search'}
    >
      <div className="pointer-events-none absolute left-0 top-0 grid size-10 place-items-center text-muted-foreground">
        <MagnifyingGlassIcon className="size-5" />
      </div>
      <Input
        aria-hidden={!open}
        className={cn(
          'h-full border-0 bg-transparent pl-11 pr-[4.6rem] text-sm opacity-100 transition-[opacity,transform] duration-150 ease-[var(--ease-out-strong)] focus-visible:ring-0 disabled:opacity-0 motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-1',
        )}
        disabled={!open}
        placeholder="Search"
        tabIndex={open ? undefined : -1}
      />
      <KbdGroup
        className={cn(
          'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 transition-[opacity,transform] duration-150 ease-[var(--ease-out-strong)] motion-reduce:transition-none',
          open ? 'translate-x-0 opacity-100' : 'translate-x-1 opacity-0',
        )}
      >
        <Kbd className={key}>
          <span className="sr-only">Command</span>
          <CommandIcon className="size-3.5" />
        </Kbd>
        <Kbd className={key}>K</Kbd>
      </KbdGroup>
    </div>
  );
}

export { SearchBox };
