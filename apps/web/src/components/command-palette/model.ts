import type {
  CommandAction,
  CommandEvent,
  CommandItem,
  CommandPageId,
  CommandRegistry,
  CommandSearchDocument,
  CommandSession,
  PageRef,
} from '~/components/command-palette/types';

const MAX_RECENTS = 20;
const ROOT = 'root';

function ref(id: CommandPageId, query = ''): PageRef {
  return { id, query };
}

function init(value: CommandPageId): CommandSession {
  const root = ref(ROOT);

  return {
    panel: { kind: 'list' },
    stack: value === ROOT ? [root] : [root, ref(value)],
  };
}

function current(state: CommandSession) {
  return state.stack[state.stack.length - 1] ?? state.stack[0];
}

function previous(state: CommandSession) {
  if (state.stack.length > 1) return state.stack[state.stack.length - 2] ?? ref(ROOT);
  if (current(state).id === ROOT) return null;

  return ref(ROOT);
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
        if (current(state).id === ROOT) return state;

        return {
          ...state,
          panel: { kind: 'list' },
          selected: undefined,
          stack: [ref(ROOT)],
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
        stack: [...state.stack, ref(event.page, event.query ?? '')],
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

function stale(registry: CommandRegistry, value: readonly string[]) {
  return value.filter((item) => registry.items.has(item)).slice(0, MAX_RECENTS);
}

function filter<T extends CommandSearchDocument>(items: readonly T[], query: string) {
  return items.filter((item) => accepts(item, query));
}

function accepts(item: CommandSearchDocument, query: string) {
  const term = norm(query);

  if (!term) return true;

  return [item.title, item.subtitle ?? '', item.source, ...item.keywords].some((value) =>
    norm(value).includes(term),
  );
}

function actionAccepts(item: CommandAction, query: string) {
  const term = norm(query);

  if (!term) return true;

  return [item.title, item.label ?? '', item.hotkey ?? ''].some((value) =>
    norm(String(value)).includes(term),
  );
}

function visible(page: CommandPageId, root: CommandPageId) {
  return page === root ? ROOT : page;
}

function byId(items: readonly CommandItem[]) {
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
  ROOT,
  accepts,
  actionAccepts,
  byId,
  current,
  filter,
  init,
  norm,
  previous,
  reducer,
  ref,
  remember,
  stale,
  visible,
};
