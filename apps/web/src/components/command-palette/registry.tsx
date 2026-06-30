import type { Icon } from '@phosphor-icons/react';
import type { ReactElement, ReactNode } from 'react';

import { Children, Fragment, isValidElement } from 'react';

import type {
  CommandAction,
  CommandId,
  CommandModule,
  CommandPage,
  CommandPageId,
  CommandPaletteConfig,
  CommandRegistry,
  CommandRun,
  CommandSection,
  CommandShortcut,
  CommandSource,
  CommandTone,
} from '~/components/command-palette/types';

const mark = Symbol('command-palette-node');
const ROOT = 'root';

type Kind = 'action' | 'copy' | 'danger' | 'detail' | 'item' | 'page' | 'push' | 'section';

type Marked<TProps, TKind extends Kind> = ((props: TProps) => null) & {
  [mark]: TKind;
};

type PageProps = {
  children?: ReactNode;
  id: CommandPageId;
  placeholder: string;
  title: string;
};

type SectionProps = {
  children?: ReactNode;
  id: CommandId;
  title: string;
};

type ItemProps = {
  children?: ReactNode;
  icon: Icon;
  id: CommandId;
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
  id: CommandId;
  run: CommandRun;
  shortcut?: CommandShortcut;
  submit?: boolean;
  tone?: CommandTone;
};

type PushProps = {
  children?: ReactNode;
  icon?: Icon;
  id: CommandId;
  page: CommandPageId | PageNode;
  query?: string;
  shortcut?: CommandShortcut;
  submit?: boolean;
};

type CopyProps = {
  children?: ReactNode;
  icon?: Icon;
  id: CommandId;
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

type Build = {
  actions: Map<CommandId, { action: CommandAction; item: CommandSection['items'][number] }>;
  ids: Set<string>;
  items: Map<CommandId, CommandSection['items'][number]>;
  pages: Map<CommandPageId, CommandPage>;
  pending: Set<CommandPageId>;
  root: CommandPageId;
};

function definePalette<TDeps>(value: CommandPaletteConfig<TDeps>) {
  return value;
}

function defineCommandModule<TDeps, TData>(value: CommandModule<TDeps, TData>) {
  return value;
}

function createCommandIds(scope: string) {
  return {
    action: (item: string, action: string) => join(scope, item, action),
    item: (...parts: string[]) => join(scope, ...parts),
    page: (...parts: string[]) => join(scope, 'page', ...parts),
  };
}

function compileCommandPalette(node: ReactNode, root = ROOT): CommandRegistry {
  const build: Build = {
    actions: new Map(),
    ids: new Set(),
    items: new Map(),
    pages: new Map(),
    pending: new Set(),
    root,
  };

  collect(node).forEach((item) => {
    expect(item, 'page');
    compilePage(build, item as PageNode);
  });

  if (!build.pages.has(root)) {
    throw new Error(`Command palette is missing root page "${root}".`);
  }

  build.pending.forEach((id) => {
    if (!build.pages.has(id)) {
      throw new Error(`Command palette action pushes missing page "${id}".`);
    }
  });

  return {
    actions: build.actions,
    items: build.items,
    pages: build.pages,
    root,
  };
}

function page(_props: PageProps) {
  return null;
}

function section(_props: SectionProps) {
  return null;
}

function item(_props: ItemProps) {
  return null;
}

function detail(_props: DetailProps) {
  return null;
}

function action(_props: ActionProps) {
  return null;
}

function push(_props: PushProps) {
  return null;
}

function copy(_props: CopyProps) {
  return null;
}

function danger(_props: DangerProps) {
  return null;
}

const Page = tag(page, 'page');
const Section = tag(section, 'section');
const Item = tag(item, 'item');
const Detail = tag(detail, 'detail');
const Action = tag(action, 'action') as ActionComponent;
Action.Push = tag(push, 'push');
Action.Copy = tag(copy, 'copy');
Action.Danger = tag(danger, 'danger');

const Command = {
  Action,
  Detail,
  Item,
  Page,
  Section,
};

function compilePage(build: Build, node: PageNode) {
  unique(build, `page:${node.props.id}`, `Command page "${node.props.id}" is declared twice.`);

  const page: CommandPage = {
    id: node.props.id,
    placeholder: node.props.placeholder,
    sections: collect(node.props.children).map((item) => {
      expect(item, 'section');
      return compileSection(build, item as ReactElement<SectionProps>);
    }),
    title: node.props.title,
  };
  const submit = page.sections
    .flatMap((item) => item.items)
    .flatMap((item) => item.actions)
    .find((item) => item.submit);

  build.pages.set(node.props.id, submit ? { ...page, submit } : page);
}

function compileSection(build: Build, node: ReactElement<SectionProps>) {
  expect(node, 'section');

  return {
    id: node.props.id,
    items: collect(node.props.children).map((item) => {
      expect(item, 'item');
      return compileItem(build, item as ReactElement<ItemProps>);
    }),
    title: node.props.title,
  } satisfies CommandSection;
}

function compileItem(build: Build, node: ReactElement<ItemProps>) {
  expect(node, 'item');
  unique(build, `item:${node.props.id}`, `Command item "${node.props.id}" is declared twice.`);

  const detail = collect(node.props.children).find((item) => kind(item) === 'detail') as
    | ReactElement<DetailProps>
    | undefined;
  const actions = collect(node.props.children)
    .filter((item) => actionKind(item))
    .map((item) => compileAction(build, node.props, item));

  if (!actions.length) {
    throw new Error(`Command item "${node.props.id}" must declare at least one action.`);
  }

  const value = {
    actions: actions as [CommandAction, ...CommandAction[]],
    detail: detail?.props.children,
    icon: node.props.icon,
    id: node.props.id,
    keywords: node.props.keywords ?? [],
    primary: actions[0]!,
    source: node.props.source ?? 'workspace',
    subtitle: node.props.subtitle,
    title: node.props.title,
  };

  build.items.set(value.id, value);
  value.actions.forEach((action) => {
    build.actions.set(action.id, { action, item: value });
  });

  return value;
}

function compileAction(build: Build, owner: ItemProps, node: ReactElement) {
  const type = kind(node);
  const props = node.props as ActionProps & CopyProps & DangerProps & PushProps;
  const id = join(owner.id, props.id);
  const base = {
    hotkey: hotkey(props.shortcut),
    icon: props.icon,
    id,
    label: label(props.shortcut),
    shortcut: props.shortcut,
    submit: props.submit,
    title: title(props.children),
  };

  unique(build, `action:${id}`, `Command action "${id}" is declared twice.`);

  switch (type) {
    case 'copy':
      return {
        ...base,
        run: (ctx) => ctx.copy(typeof props.value === 'function' ? props.value() : props.value),
      } satisfies CommandAction;
    case 'danger':
      return {
        ...base,
        run: props.run,
        tone: 'danger',
      } satisfies CommandAction;
    case 'push':
      return {
        ...base,
        run: (ctx) => ctx.page(pushPage(build, props.page), props.query),
      } satisfies CommandAction;
    default:
      return {
        ...base,
        run: props.run,
        tone: props.tone,
      } satisfies CommandAction;
  }
}

function pushPage(build: Build, value: CommandPageId | PageNode) {
  if (typeof value === 'string') {
    build.pending.add(value);
    return value;
  }

  expect(value, 'page');
  build.pending.add(value.props.id);

  if (!build.pages.has(value.props.id)) compilePage(build, value);

  return value.props.id;
}

function collect(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((item) => {
    if (!isValidElement(item)) return [];
    if (item.type === Fragment) return collect((item.props as { children?: ReactNode }).children);

    return [item];
  });
}

function actionKind(node: ReactElement) {
  const type = kind(node);

  return type === 'action' || type === 'copy' || type === 'danger' || type === 'push';
}

function expect(node: ReactElement, value: Kind): asserts node is ReactElement {
  if (kind(node) !== value) {
    throw new Error(`Expected command ${value} node.`);
  }
}

function kind(node: ReactElement) {
  return (node.type as Partial<Record<typeof mark, Kind>>)[mark];
}

function tag<TProps, TKind extends Kind>(fn: (props: TProps) => null, kind: TKind) {
  return Object.assign(fn, { [mark]: kind }) as Marked<TProps, TKind>;
}

function unique(build: Build, id: string, message: string) {
  if (build.ids.has(id)) throw new Error(message);

  build.ids.add(id);
}

function join(...parts: readonly string[]) {
  return parts.map((item) => item.replaceAll(':', '_')).join(':');
}

function title(node: ReactNode) {
  return Children.toArray(node)
    .filter((item): item is number | string => typeof item === 'string' || typeof item === 'number')
    .join('')
    .trim();
}

function hotkey(value: CommandShortcut | undefined) {
  return shortcut(value) ? value.hotkey : value;
}

function label(value: CommandShortcut | undefined) {
  return shortcut(value) ? value.label : undefined;
}

function shortcut(
  value: CommandShortcut | undefined,
): value is Extract<CommandShortcut, { hotkey: unknown }> {
  return typeof value === 'object' && value !== null && 'hotkey' in value;
}

export { Command, compileCommandPalette, createCommandIds, defineCommandModule, definePalette };
