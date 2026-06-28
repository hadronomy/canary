import type { ComponentPropsWithoutRef, ReactElement } from 'react';

import {
  CaretLeftIcon as ChevronLeftIcon,
  CaretRightIcon as ChevronRightIcon,
  GearSixIcon,
  type Icon,
  QuestionIcon,
  StackIcon,
} from '@phosphor-icons/react';
import { useLiveQuery } from '@tanstack/react-db';
import { Link, useRouter } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';

import type { ShellNavRoute, ShellUser } from '~/components/shell/routes';

import { AccountPanel } from '~/components/shell/account';
import { Brand } from '~/components/shell/brand';
import { ease, primaryNav } from '~/components/shell/routes';
import { ShellSearch } from '~/components/shell/search';
import { SyncStatus } from '~/components/shell/status';
import { UserAvatar } from '~/components/shell/user-avatar';
import { Button } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';
import { roster } from '~/utils/chat';

type DesktopNavProps = Omit<
  ComponentPropsWithoutRef<typeof motion.aside>,
  'animate' | 'children' | 'initial' | 'transition'
> & {
  onToggle: () => void;
  open: boolean;
  ready: boolean;
  user: ShellUser;
};

type MobileNavProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  ready: boolean;
  user: ShellUser;
};

function DesktopNav({ className, onToggle, open, ready, user, ...props }: DesktopNavProps) {
  const reduce = useReducedMotion();

  return (
    <motion.aside
      animate={{ width: open ? 272 : 72 }}
      className={cn('relative hidden h-full min-h-0 shrink-0 overflow-visible md:block', className)}
      initial={false}
      transition={reduce ? { duration: 0 } : { duration: 0.2, ease: ease.ease }}
      {...props}
    >
      <Elevated
        offset={1}
        shadowLevel={2}
        className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-5 overflow-hidden rounded-(--radius-shell) border border-sidebar-border p-4 text-sidebar-foreground"
      >
        <Header open={open} />
        <Search open={open} onReveal={onToggle} />

        <nav className="grid content-start gap-1">
          {primaryNav.map((item) => (
            <SideLink item={item} key={item.to} open={open} />
          ))}
        </nav>

        <Footer open={open} ready={ready} user={user} />
      </Elevated>

      <Edge open={open} onToggle={onToggle} />
    </motion.aside>
  );
}

function MobileNav({ className, ready, user, ...props }: MobileNavProps) {
  return (
    <div className={cn('grid gap-3', className)} {...props}>
      <Brand />

      <Search open />

      <nav className="grid content-start gap-1">
        {primaryNav.map((item) => (
          <SideLink item={item} key={item.to} open />
        ))}
      </nav>

      {ready ? <Footer user={user} /> : <SyncPanel />}
    </div>
  );
}

function Header(props: { open: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Brand compact={!props.open} />
    </div>
  );
}

function Edge(props: { onToggle: () => void; open: boolean }) {
  const Icon = props.open ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <div className="group/edge pointer-events-none absolute -right-5 top-0 z-20 flex h-full w-10 justify-center">
      <Button
        aria-label={props.open ? 'Collapse sidebar' : 'Expand sidebar'}
        className="pointer-events-auto mt-5 size-8 rounded-md bg-transparent text-muted-foreground opacity-0 transition-[color,opacity] duration-150 ease-out-strong hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover/edge:opacity-100"
        size="icon"
        type="button"
        variant="ghost"
        onClick={props.onToggle}
      >
        <Icon className="size-4" />
      </Button>
    </div>
  );
}

function Search(props: { onReveal?: () => void; open: boolean }) {
  return <ShellSearch open={props.open} onReveal={props.onReveal} />;
}

function SideLink(props: { item: ShellNavRoute; open: boolean }) {
  const Icon = props.item.icon;

  const base = cn(
    'group relative flex h-10 items-center overflow-hidden rounded-(--radius-control) border border-transparent text-sm font-medium text-muted-foreground',
    'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-strong',
    'hover:border-input/55 hover:bg-surface-3/70 hover:text-foreground',
    props.open ? 'w-full justify-start px-3' : 'size-10 justify-center px-0',
  );

  const active = cn(
    'border-input/70 bg-surface-3 text-foreground shadow-surface-1',
    'hover:border-input/70 hover:bg-surface-3',
  );

  const node = (
    <Link
      activeOptions={{ exact: props.item.nav.exact }}
      activeProps={{ className: active }}
      aria-label={props.open ? undefined : props.item.label}
      className={base}
      to={props.item.to}
    >
      <Icon className="size-5 shrink-0" />

      <span
        aria-hidden={!props.open}
        className={cn(
          'pointer-events-none absolute left-11 right-3 min-w-0 truncate transition-[opacity,transform,filter] duration-150 ease-out-strong motion-reduce:transition-none',
          props.open ? 'translate-x-0 opacity-100 blur-0' : 'translate-x-1 opacity-0 blur-[1px]',
        )}
      >
        {props.item.label}
      </span>
    </Link>
  );

  if (props.open) {
    return node;
  }

  return <Tip label={props.item.label}>{node}</Tip>;
}

function IconButton(props: { icon: Icon; label: string }) {
  return (
    <Tip label={props.label}>
      <Button
        aria-label={props.label}
        className="size-10 rounded-(--radius-press) text-muted-foreground hover:bg-surface-3/70 hover:text-foreground"
        size="icon"
        type="button"
        variant="ghost"
      >
        <props.icon className="size-5" />
      </Button>
    </Tip>
  );
}

function CompactTools(props: { ready: boolean; user: ShellUser }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Separator className="mb-3 mt-2 w-8 bg-input/70" />

      <IconButton icon={GearSixIcon} label="Settings" />
      <IconButton icon={QuestionIcon} label="Help" />

      <Elevated
        offset={1}
        shadowLevel={1}
        className="relative mt-3 grid size-10 place-items-center rounded-full border border-border text-muted-foreground"
      >
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: props.ready
              ? 'conic-gradient(var(--primary) 0 70%, transparent 70% 100%)'
              : undefined,
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))',
          }}
        />
        <StackIcon className="size-5" />
      </Elevated>

      <UserAvatar className="size-10" ready={props.ready} size="lg" user={props.user} />
    </div>
  );
}

function Footer(props: { open?: boolean; ready?: boolean; user: ShellUser }) {
  const router = useRouter();
  const threads = useLiveQuery(roster(props.user.id)).data;

  async function signout() {
    await authClient.signOut();
    router.options.context.queryClient.setQueryData(userKey, null);
    await router.invalidate();
  }

  if (props.open === false) {
    return (
      <footer>
        <CompactTools ready={props.ready ?? true} user={props.user} />
      </footer>
    );
  }

  return props.ready === false ? (
    <SyncPanel />
  ) : (
    <footer className="grid min-w-0 gap-2 overflow-hidden">
      <SyncStatus threads={threads.length} />
      <AccountPanel user={props.user} onSignout={signout} />
    </footer>
  );
}

function SyncPanel() {
  return (
    <div className="grid rounded-(--radius-control) border border-border bg-card/80 p-3 text-xs text-muted-foreground">
      Preparing local sync...
    </div>
  );
}

function Tip(props: { children: ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

export { DesktopNav, MobileNav };
export type { DesktopNavProps, MobileNavProps };
