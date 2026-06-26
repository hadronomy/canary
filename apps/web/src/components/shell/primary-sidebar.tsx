import type { Icon } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

import { useLiveQuery } from '@tanstack/react-db';
import { Link, useRouter } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';

import type { ShellNavRoute, ShellUser } from '~/components/shell/model';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GearSixIcon,
  QuestionIcon,
  StackIcon,
} from '~/components/icons';
import { AccountCard } from '~/components/shell/account-card';
import { Brand } from '~/components/shell/brand';
import { ease, primaryNav } from '~/components/shell/model';
import { SearchBox } from '~/components/shell/search-box';
import { StatusMeter } from '~/components/shell/status-meter';
import { UserAvatar } from '~/components/shell/user-avatar';
import { Button } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';
import { cn } from '~/lib/utils';
import { roster } from '~/utils/chat';

function PrimarySidebar(props: {
  onToggle: () => void;
  open: boolean;
  ready: boolean;
  user: ShellUser;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.aside
      animate={{ width: props.open ? 272 : 72 }}
      className="relative hidden h-full min-h-0 shrink-0 overflow-visible md:block"
      initial={false}
      transition={reduce ? { duration: 0 } : { duration: 0.2, ease: ease.ease }}
    >
      <div className="canary-panel grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-5 overflow-hidden rounded-(--radius-shell) p-4">
        <Header open={props.open} />
        <Search open={props.open} />

        <nav className="grid content-start gap-1">
          {primaryNav.map((item) => (
            <SideLink item={item} key={item.to} open={props.open} />
          ))}
        </nav>

        <Footer open={props.open} ready={props.ready} user={props.user} />
      </div>

      <Edge open={props.open} onToggle={props.onToggle} />
    </motion.aside>
  );
}

function PrimaryMobile(props: { ready: boolean; user: ShellUser }) {
  return (
    <div className="grid gap-3">
      <Brand />

      <Search open />

      <nav className="grid content-start gap-1">
        {primaryNav.map((item) => (
          <SideLink item={item} key={item.to} open />
        ))}
      </nav>

      {props.ready ? <Footer user={props.user} /> : <SyncPanel />}
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
        className="pointer-events-auto mt-5 size-8 rounded-none bg-transparent text-muted-foreground opacity-0 transition-[color,opacity] duration-150 ease-out-strong hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover/edge:opacity-100"
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

function Search(props: { open: boolean }) {
  return <SearchBox open={props.open} />;
}

function SideLink(props: { item: ShellNavRoute; open: boolean }) {
  const Icon = props.item.icon;

  const base = cn(
    'group relative flex h-10 items-center overflow-hidden rounded-(--radius-control) border border-transparent text-sm font-medium text-muted-foreground',
    'transition-[background-color,border-color,color] duration-150 ease-out-strong',
    'hover:border-line hover:bg-row-hover hover:text-foreground',
    props.open ? 'w-full justify-start px-3' : 'size-10 justify-center px-0',
  );

  const active = cn(
    'border-line-strong bg-row text-foreground',
    'hover:border-line-strong hover:bg-row',
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
        className="size-10 rounded-(--radius-press) text-muted-foreground hover:bg-row-hover hover:text-foreground"
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
      <Separator className="mb-3 mt-2 w-8 bg-line-strong" />

      <IconButton icon={GearSixIcon} label="Settings" />
      <IconButton icon={QuestionIcon} label="Help" />

      <div className="relative mt-3 grid size-10 place-items-center rounded-full border border-line bg-surface-raised text-muted-foreground">
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: props.ready
              ? 'conic-gradient(var(--canary-success) 0 70%, transparent 70% 100%)'
              : undefined,
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))',
          }}
        />
        <StackIcon className="size-5" />
      </div>

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
      <StatusMeter threads={threads.length} />
      <AccountCard user={props.user} onSignout={signout} />
    </footer>
  );
}

function SyncPanel() {
  return (
    <div className="grid rounded-(--radius-control) border border-line bg-surface/80 p-3 text-xs text-muted-foreground">
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

export { PrimaryMobile, PrimarySidebar };
