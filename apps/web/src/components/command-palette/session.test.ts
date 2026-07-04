import { describe, expect, test } from 'bun:test';

import { current, init, reducer } from '~/components/command-palette/session';
import { itemId, pageId } from '~/components/command-palette/types';

describe('command palette session', () => {
  test('keeps query while leaving without execution', () => {
    const state = reducer(init(pageId('root')), { type: 'query', query: 'theme' });

    expect(current(state).query).toBe('theme');
  });

  test('clears query after command execution', () => {
    const state = reducer(reducer(init(pageId('root')), { type: 'query', query: 'theme' }), {
      type: 'commit',
    });

    expect(current(state).query).toBe('');
  });

  test('keeps active page but clears page query after command execution', () => {
    const page = pageId('theme');
    const state = reducer(
      reducer(reducer(init(pageId('root')), { type: 'query', query: 'theme' }), {
        type: 'push',
        page,
        query: 'light',
      }),
      { type: 'commit' },
    );

    expect(current(state).id).toBe(page);
    expect(current(state).query).toBe('');
  });

  test('clears action panel state after command execution', () => {
    const state = reducer(
      reducer(init(pageId('root')), { type: 'open-actions', item: itemId('theme') }),
      { type: 'commit' },
    );

    expect(state.panel.kind).toBe('list');
  });

  test('can keep action panel state after stay-action execution', () => {
    const state = reducer(
      reducer(init(pageId('root')), { type: 'open-actions', item: itemId('theme') }),
      { type: 'commit', keepPanel: true },
    );

    expect(state.panel.kind).toBe('actions');
  });
});
