import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { describe, expect, test } from 'bun:test';

import {
  compileCommandPalette,
  createCommandIds,
  defineCommandModule,
  definePalette,
} from '~/components/command-palette/compiler';
import { Command } from '~/components/command-palette/dsl';

const ids = createCommandIds('test');

describe('command palette compiler', () => {
  test('compiles declared command pages', () => {
    const registry = compileCommandPalette(
      <Command.Page id={ids.page('root')} placeholder="Search..." title="Root">
        <Command.Section id={ids.section('root')} title="Root">
          <Command.Item icon={MagnifyingGlassIcon} id={ids.item('search')} title="Search">
            <Command.Action id="open" run={() => undefined}>
              Open
            </Command.Action>
          </Command.Item>
        </Command.Section>
      </Command.Page>,
      ids.page('root'),
    );

    expect(registry.pages.has(ids.page('root'))).toBe(true);
    expect(registry.items.has(ids.item('search'))).toBe(true);
    expect(registry.actions.has(ids.action(ids.item('search'), 'open'))).toBe(true);
  });

  test('rejects duplicate item ids', () => {
    expect(() =>
      compileCommandPalette(
        <Command.Page id={ids.page('root')} placeholder="Search..." title="Root">
          <Command.Section id={ids.section('root')} title="Root">
            <Command.Item icon={MagnifyingGlassIcon} id={ids.item('same')} title="One">
              <Command.Action id="open" run={() => undefined}>
                Open
              </Command.Action>
            </Command.Item>
            <Command.Item icon={MagnifyingGlassIcon} id={ids.item('same')} title="Two">
              <Command.Action id="open" run={() => undefined}>
                Open
              </Command.Action>
            </Command.Item>
          </Command.Section>
        </Command.Page>,
        ids.page('root'),
      ),
    ).toThrow('declared twice');
  });

  test('rejects missing push targets', () => {
    expect(() =>
      compileCommandPalette(
        <Command.Page id={ids.page('root')} placeholder="Search..." title="Root">
          <Command.Section id={ids.section('root')} title="Root">
            <Command.Item icon={MagnifyingGlassIcon} id={ids.item('search')} title="Search">
              <Command.Action.Push id="open" page={ids.page('missing')}>
                Open
              </Command.Action.Push>
            </Command.Item>
          </Command.Section>
        </Command.Page>,
        ids.page('root'),
      ),
    ).toThrow('missing page');
  });

  test('rejects duplicate module ids', () => {
    const mod = defineCommandModule({
      id: 'duplicate',
      render: () => ({}),
      useData: () => null,
    });

    expect(() =>
      definePalette({
        id: 'test',
        modules: [mod, mod],
        root: {
          id: ids.page('root'),
          placeholder: 'Search...',
          title: 'Root',
        },
      }),
    ).toThrow('declared twice');
  });
});
