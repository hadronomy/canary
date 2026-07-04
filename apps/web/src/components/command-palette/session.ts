import type {
  CommandEvent,
  CommandSession,
  PageId,
  PageRef,
} from '~/components/command-palette/types';

import { ROOT_PAGE } from '~/components/command-palette/types';

function ref(id: PageId, query = ''): PageRef {
  return { id, query };
}

function init(value: PageId): CommandSession {
  const root = ref(ROOT_PAGE);

  return {
    panel: { kind: 'list' },
    stack: value === ROOT_PAGE ? [root] : [root, ref(value)],
  };
}

function current(state: CommandSession) {
  return state.stack[state.stack.length - 1] ?? state.stack[0];
}

function previous(state: CommandSession) {
  if (state.stack.length > 1) return state.stack[state.stack.length - 2] ?? ref(ROOT_PAGE);
  if (current(state).id === ROOT_PAGE) return null;

  return ref(ROOT_PAGE);
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
        if (current(state).id === ROOT_PAGE) return state;

        return {
          ...state,
          panel: { kind: 'list' },
          selected: undefined,
          stack: [ref(ROOT_PAGE)],
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
    case 'commit':
      return {
        ...state,
        panel: event.keepPanel ? state.panel : { kind: 'list' },
        selected: undefined,
        stack: clean(state.stack),
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

function clean(stack: CommandSession['stack']): CommandSession['stack'] {
  return [ref(stack[0].id), ...stack.slice(1).map((item) => ref(item.id))];
}

export { ROOT_PAGE, current, init, previous, reducer, ref };
