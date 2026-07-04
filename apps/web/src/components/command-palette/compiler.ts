import type { ReactElement, ReactNode } from 'react';

import { Children, Fragment, createElement, isValidElement } from 'react';

import type {
  ActionNode,
  ActionProps,
  CopyProps,
  DangerProps,
  NodeKind,
  DetailNode,
  ItemNode,
  ItemProps,
  PageNode,
  PushProps,
  SectionNode,
} from '~/components/command-palette/dsl';
import type {
  ActionId,
  CommandAction,
  CommandModule,
  CommandPage,
  CommandPaletteConfig,
  CommandRegistry,
  CommandRoot,
  CommandSection,
  CommandShortcut,
  ItemId,
  PageId,
} from '~/components/command-palette/types';

import { Command, nodeKind } from '~/components/command-palette/dsl';
import {
  ROOT_PAGE,
  actionId,
  itemId,
  pageId,
  paletteId,
  sectionId,
} from '~/components/command-palette/types';

type Build = {
  actions: Map<ActionId, { action: CommandAction; item: CommandSection['items'][number] }>;
  ids: Set<string>;
  items: Map<ItemId, CommandSection['items'][number]>;
  pages: Map<PageId, CommandPage>;
  pending: Set<PageId>;
  root: PageId;
};

function definePalette<TDeps>(cfg: CommandPaletteConfig<TDeps>) {
  const root = cfg.root.id ?? ROOT_PAGE;

  moduleIds(cfg.modules);

  return {
    ...cfg,
    id: paletteId(String(cfg.id)),
    root: { ...cfg.root, id: root },
    compile: (deps: TDeps) =>
      compileCommandPalette(renderPalette(cfg.root, cfg.modules, deps), root),
    render: (deps: TDeps) => renderPalette(cfg.root, cfg.modules, deps),
  };
}

function moduleIds(mods: readonly { id: string }[]) {
  const ids = new Set<string>();

  mods.forEach((mod) => {
    if (ids.has(mod.id)) {
      throw new Error(`Command module "${mod.id}" is declared twice.`);
    }

    ids.add(mod.id);
  });
}

function defineCommandModule<TDeps, TData>(
  cfg: Omit<CommandModule<TDeps, TData>, 'kind' | 'view'>,
) {
  return {
    ...cfg,
    kind: 'command-module' as const,
    view: (deps: TDeps) => cfg.render(cfg.useData(deps), deps),
  };
}

function createCommandIds(scope: string) {
  return {
    action: (item: ItemId, action: string) => actionId(join(item, action)),
    item: (...parts: readonly string[]) => itemId(join(scope, ...parts)),
    page: (...parts: readonly string[]) => pageId(join(scope, 'page', ...parts)),
    palette: () => paletteId(scope),
    section: (...parts: readonly string[]) => sectionId(join(scope, 'section', ...parts)),
  };
}

function compileCommandPalette(node: ReactNode, root = ROOT_PAGE): CommandRegistry {
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
    compilePage(build, item);
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

function renderPalette<TDeps>(
  root: CommandRoot,
  modules: readonly Pick<CommandModule<TDeps, unknown>, 'view'>[],
  deps: TDeps,
) {
  const views = modules.map((item) => item.view(deps));

  return createElement(
    Fragment,
    null,
    createElement(
      Command.Page,
      {
        id: root.id ?? ROOT_PAGE,
        placeholder: root.placeholder,
        title: root.title,
      },
      views.map((item) => item.sections),
    ),
    views.map((item) => item.pages),
  );
}

function compilePage(build: Build, node: PageNode) {
  unique(build, `page:${node.props.id}`, `Command page "${node.props.id}" is declared twice.`);

  const page: CommandPage = {
    id: node.props.id,
    placeholder: node.props.placeholder,
    sections: collect(node.props.children).map((item) => {
      expect(item, 'section');
      return compileSection(build, item);
    }),
    title: node.props.title,
  };
  const submit = page.sections
    .flatMap((item) => item.items)
    .flatMap((item) => item.actions)
    .find((item) => item.submit);

  build.pages.set(node.props.id, submit ? { ...page, submit } : page);
}

function compileSection(build: Build, node: SectionNode) {
  return {
    id: node.props.id,
    items: collect(node.props.children).map((item) => {
      expect(item, 'item');
      return compileItem(build, item);
    }),
    title: node.props.title,
  } satisfies CommandSection;
}

function compileItem(build: Build, node: ItemNode) {
  unique(build, `item:${node.props.id}`, `Command item "${node.props.id}" is declared twice.`);

  const detail = collect(node.props.children).find((item) => nodeKind(item) === 'detail') as
    | DetailNode
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

function compileAction(build: Build, owner: ItemProps, node: ActionNode) {
  const type = nodeKind(node);
  const props = node.props as ActionProps & CopyProps & DangerProps & PushProps;
  const id = actionId(join(owner.id, props.id));
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
    case 'push': {
      const page = pushPage(build, props.page);

      return {
        ...base,
        run: (ctx) => ctx.page(page, props.query),
      } satisfies CommandAction;
    }
    default:
      return {
        ...base,
        run: props.run,
        tone: props.tone,
      } satisfies CommandAction;
  }
}

function pushPage(build: Build, value: PageId | PageNode) {
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

function actionKind(node: ReactElement): node is ActionNode {
  const type = nodeKind(node);

  return type === 'action' || type === 'copy' || type === 'danger' || type === 'push';
}

function expect(node: ReactElement, value: 'page'): asserts node is PageNode;
function expect(node: ReactElement, value: 'section'): asserts node is SectionNode;
function expect(node: ReactElement, value: 'item'): asserts node is ItemNode;
function expect(node: ReactElement, value: 'detail'): asserts node is DetailNode;
function expect(node: ReactElement, value: NodeKind): asserts node is ReactElement {
  if (nodeKind(node) !== value) {
    throw new Error(`Expected command ${value} node.`);
  }
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

export { compileCommandPalette, createCommandIds, defineCommandModule, definePalette };
