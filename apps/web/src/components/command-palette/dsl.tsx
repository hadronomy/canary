import type { Icon } from '@phosphor-icons/react';
import type { ReactElement, ReactNode } from 'react';

import type {
  CommandRun,
  CommandShortcut,
  CommandSource,
  CommandTone,
  ItemId,
  PageId,
  SectionId,
} from '~/components/command-palette/types';

const mark = Symbol('command-palette-node');

type NodeKind = 'action' | 'copy' | 'danger' | 'detail' | 'item' | 'page' | 'push' | 'section';

type Marked<TProps, TKind extends NodeKind> = ((props: TProps) => null) & {
  [mark]: TKind;
};

type PageProps = {
  children?: ReactNode;
  id: PageId;
  placeholder: string;
  title: string;
};

type SectionProps = {
  children?: ReactNode;
  id: SectionId;
  title: string;
};

type ItemProps = {
  children?: ReactNode;
  icon: Icon;
  id: ItemId;
  keywords?: readonly string[];
  source?: CommandSource;
  subtitle?: string;
  title: string;
};

type DetailProps = {
  children?: ReactNode;
};

type ActionProps = {
  children?: ReactNode;
  icon?: Icon;
  id: string;
  run: CommandRun;
  shortcut?: CommandShortcut;
  submit?: boolean;
  tone?: CommandTone;
};

type PushProps = {
  children?: ReactNode;
  icon?: Icon;
  id: string;
  page: PageId | PageNode;
  query?: string;
  shortcut?: CommandShortcut;
  submit?: boolean;
};

type CopyProps = {
  children?: ReactNode;
  icon?: Icon;
  id: string;
  shortcut?: CommandShortcut;
  submit?: boolean;
  value: string | (() => string);
};

type DangerProps = Omit<ActionProps, 'tone'>;

type ActionComponent = Marked<ActionProps, 'action'> & {
  Copy: Marked<CopyProps, 'copy'>;
  Danger: Marked<DangerProps, 'danger'>;
  Push: Marked<PushProps, 'push'>;
};

type PageNode = ReactElement<PageProps, Marked<PageProps, 'page'>>;
type SectionNode = ReactElement<SectionProps, Marked<SectionProps, 'section'>>;
type ItemNode = ReactElement<ItemProps, Marked<ItemProps, 'item'>>;
type DetailNode = ReactElement<DetailProps, Marked<DetailProps, 'detail'>>;
type ActionNode = ReactElement<ActionProps | CopyProps | DangerProps | PushProps>;

function leaf<TProps, TKind extends NodeKind>(name: string, kind: TKind) {
  function Node(_props: TProps) {
    return null;
  }

  Node.displayName = name;

  return Object.assign(Node, { [mark]: kind }) as Marked<TProps, TKind>;
}

const Page = leaf<PageProps, 'page'>('Command.Page', 'page');
const Section = leaf<SectionProps, 'section'>('Command.Section', 'section');
const Item = leaf<ItemProps, 'item'>('Command.Item', 'item');
const Detail = leaf<DetailProps, 'detail'>('Command.Detail', 'detail');
const Action = leaf<ActionProps, 'action'>('Command.Action', 'action') as ActionComponent;
Action.Push = leaf<PushProps, 'push'>('Command.Action.Push', 'push');
Action.Copy = leaf<CopyProps, 'copy'>('Command.Action.Copy', 'copy');
Action.Danger = leaf<DangerProps, 'danger'>('Command.Action.Danger', 'danger');

const Command = {
  Action,
  Detail,
  Item,
  Page,
  Section,
};

function nodeKind(node: ReactElement) {
  return (node.type as Partial<Record<typeof mark, NodeKind>>)[mark];
}

export { Command, nodeKind };
export type {
  ActionNode,
  ActionProps,
  CopyProps,
  DangerProps,
  DetailNode,
  DetailProps,
  ItemNode,
  ItemProps,
  NodeKind,
  PageNode,
  PageProps,
  PushProps,
  SectionNode,
  SectionProps,
};
