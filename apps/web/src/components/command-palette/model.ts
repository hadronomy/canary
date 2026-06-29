import type {
  CommandAction,
  CommandEvent,
  CommandItem,
  CommandItemInput,
  CommandScreen,
  CommandSession,
  PageRef,
} from '~/components/command-palette/types';

const MAX_RECENTS = 20;

function action<const T extends CommandAction>(value: T) {
  return value;
}

function item<const T extends CommandItemInput>(value: T): CommandItem {
  return {
    ...value,
    actions: [value.primary, ...(value.actions ?? [])],
  };
}

function root(): PageRef {
  return { kind: 'root', query: '' };
}

function page(screen: CommandScreen): PageRef {
  switch (screen) {
    case 'account':
      return { kind: 'account', query: '' };
    case 'create-thread':
      return { kind: 'create-thread', query: '' };
    case 'theme':
      return { kind: 'theme', query: '' };
    case 'threads':
      return { kind: 'threads', query: '' };
    default:
      return root();
  }
}

function screen(ref: PageRef): CommandScreen | null {
  switch (ref.kind) {
    case 'account':
    case 'create-thread':
    case 'root':
    case 'theme':
    case 'threads':
      return ref.kind;
    default:
      return null;
  }
}

function init(value: CommandScreen): CommandSession {
  const start = root();

  return {
    panel: { kind: 'list' },
    stack: value === 'root' ? [start] : [start, page(value)],
  };
}

function current(state: CommandSession) {
  return state.stack[state.stack.length - 1] ?? state.stack[0];
}

function previous(state: CommandSession) {
  if (state.stack.length > 1) return state.stack[state.stack.length - 2] ?? root();
  if (current(state).kind === 'root') return null;

  return root();
}

function reducer(state: CommandSession, event: CommandEvent): CommandSession {
  switch (event.type) {
    case 'action-query':
      if (state.panel.kind !== 'actions') return state;

      return {
        ...state,
        panel: { ...state.panel, query: event.query, selected: undefined },
      };
    case 'action-select':
      if (state.panel.kind !== 'actions') return state;

      return {
        ...state,
        panel: { ...state.panel, selected: event.id },
      };
    case 'back':
      if (state.stack.length === 1) {
        if (current(state).kind === 'root') return state;

        return {
          ...state,
          panel: { kind: 'list' },
          selected: undefined,
          stack: [root()],
        };
      }

      const stack = state.stack.slice(0, -1);

      return {
        ...state,
        panel: { kind: 'list' },
        selected: undefined,
        stack: [stack[0] ?? state.stack[0], ...stack.slice(1)],
      };
    case 'close-actions':
      return {
        ...state,
        panel: { kind: 'list' },
      };
    case 'open-actions':
      return {
        ...state,
        panel: { kind: 'actions', item: event.item, query: '' },
      };
    case 'push':
      return {
        ...state,
        panel: { kind: 'list' },
        selected: undefined,
        stack: [...state.stack, event.page],
      };
    case 'query':
      return {
        ...state,
        panel: { kind: 'list' },
        stack: [
          state.stack[0],
          ...state.stack.slice(1, -1),
          { ...current(state), query: event.query },
        ],
      };
    case 'select':
      return {
        ...state,
        selected: event.id,
      };
  }
}

function remember(value: readonly string[], id: string) {
  return [id, ...value.filter((item) => item !== id)].slice(0, MAX_RECENTS);
}

function filter(items: readonly CommandItem[], query: string) {
  return items.filter((item) => accepts(item, query));
}

function accepts(item: CommandItem, query: string) {
  const term = norm(query);

  if (!term) return true;

  return [item.title, item.subtitle ?? '', item.source, ...item.keywords].some((value) =>
    norm(value).includes(term),
  );
}

function actionAccepts(item: CommandAction, query: string) {
  const term = norm(query);

  if (!term) return true;

  return [item.title, item.shortcut ?? ''].some((value) => norm(value).includes(term));
}

function byId(items: readonly CommandItem[]) {
  return new Map(items.map((item) => [item.id, item]));
}

function actionById(items: readonly CommandAction[]) {
  return new Map(items.map((item) => [item.id, item]));
}

function norm(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

export {
  accepts,
  action,
  actionAccepts,
  actionById,
  byId,
  current,
  filter,
  init,
  item,
  norm,
  page,
  previous,
  reducer,
  remember,
  screen,
};
