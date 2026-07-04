import {
  ArrowRightIcon,
  CopyIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrayArrowDownIcon,
} from '@phosphor-icons/react';

import type { ShellCommandDeps, ThreadRecord } from '~/components/shell/command-modules/types';

import {
  Command,
  CommandCard,
  createCommandIds,
  defineCommandModule,
} from '~/components/command-palette';
import { ThreadDetail } from '~/components/shell/command-modules/details';
import { after, stamp } from '~/components/shell/command-modules/utils';

const ids = createCommandIds('threads');

const threadsModule = defineCommandModule({
  id: 'threads',
  useData: (deps: ShellCommandDeps) => deps.threads,
  render: (threads, deps) => ({
    pages: (
      <>
        <Command.Page id={ids.page('search')} placeholder="Search conversations..." title="Threads">
          <Command.Section id={ids.section('search')} title="Threads">
            {threads.map((row) => threadItem(deps, row, 'search'))}
          </Command.Section>
        </Command.Page>

        <Command.Page
          id={ids.page('create')}
          placeholder="Name the new thread..."
          title="Create Thread"
        >
          <Command.Section id={ids.section('create')} title="Create">
            <Command.Item
              icon={PlusIcon}
              id={ids.item('create-submit')}
              keywords={['new', 'create', 'chat', 'thread']}
              source="thread"
              subtitle="Press Command Enter to create"
              title="Create thread"
            >
              <Command.Detail>
                <CommandCard label="Thread" title="Create thread" value="Uses the current query" />
              </Command.Detail>

              <Command.Action
                icon={PlusIcon}
                id="submit"
                shortcut="Mod+Enter"
                submit
                run={(ctx) => createThread(deps, ctx.query)}
              >
                Create thread
              </Command.Action>
            </Command.Item>
          </Command.Section>
        </Command.Page>

        {threads.map((row) => renamePage(deps, row))}
      </>
    ),
    sections: (
      <Command.Section id={ids.section('root')} title="Threads">
        <Command.Item
          icon={MagnifyingGlassIcon}
          id={ids.item('search')}
          keywords={['conversation', 'chat', 'history', 'threads']}
          source="thread"
          subtitle={`${threads.length} searchable conversations`}
          title="Search threads"
        >
          <Command.Detail>
            <CommandCard
              label="Threads"
              title="Search conversations"
              value={`${threads.length} synced conversations`}
            />
          </Command.Detail>

          <Command.Action.Push
            icon={ArrowRightIcon}
            id="open"
            page={ids.page('search')}
            shortcut="Enter"
          >
            Open
          </Command.Action.Push>
        </Command.Item>

        <Command.Item
          icon={PlusIcon}
          id={ids.item('create')}
          keywords={['new', 'create', 'chat', 'thread']}
          source="thread"
          subtitle="Prepare a fresh conversation"
          title="Create new thread"
        >
          <Command.Detail>
            <CommandCard label="Thread" title="Create thread" value="Name it from search" />
          </Command.Detail>

          <Command.Action
            icon={ArrowRightIcon}
            id="open"
            shortcut="Enter"
            run={(ctx) => ctx.page(ids.page('create'), ctx.query)}
          >
            Open create thread
          </Command.Action>
        </Command.Item>

        {threads.map((row) => threadItem(deps, row))}
      </Command.Section>
    ),
  }),
});

function threadItem(deps: ShellCommandDeps, row: ThreadRecord, scope = 'root') {
  const name = row.title.trim() || 'Untitled thread';
  const short = row.id.slice(0, 8);

  return (
    <Command.Item
      icon={MagnifyingGlassIcon}
      id={ids.item(scope, row.id)}
      key={row.id}
      keywords={[row.id, row.title, row.createdAt, row.updatedAt, short]}
      source="thread"
      subtitle={`${stamp(row.updatedAt)} · ${short}`}
      title={name}
    >
      <Command.Detail>
        <ThreadDetail row={row} />
      </Command.Detail>

      <Command.Action
        icon={ArrowRightIcon}
        id="open"
        shortcut="Enter"
        run={() => open(deps, row.id)}
      >
        Open thread
      </Command.Action>
      <Command.Action.Push
        icon={PencilSimpleIcon}
        id="rename"
        page={ids.page('rename', row.id)}
        query={name}
      >
        Rename thread
      </Command.Action.Push>
      <Command.Action.Copy icon={CopyIcon} id="copy-title" value={name}>
        Copy title
      </Command.Action.Copy>
      <Command.Action.Copy icon={CopyIcon} id="copy-id" value={row.id}>
        Copy id
      </Command.Action.Copy>
      <Command.Action.Danger
        icon={TrayArrowDownIcon}
        id="archive"
        run={() => archive(deps, row.id)}
      >
        Archive thread
      </Command.Action.Danger>
    </Command.Item>
  );
}

function renamePage(deps: ShellCommandDeps, row: ThreadRecord) {
  const name = row.title.trim() || 'Untitled thread';

  return (
    <Command.Page
      id={ids.page('rename', row.id)}
      key={row.id}
      placeholder="Rename thread..."
      title="Rename Thread"
    >
      <Command.Section id={ids.section('rename', row.id)} title="Rename">
        <Command.Item
          icon={PencilSimpleIcon}
          id={ids.item('rename-submit', row.id)}
          keywords={[row.id, row.title]}
          source="thread"
          subtitle="Press Command Enter to rename"
          title="Rename thread"
        >
          <Command.Detail>
            <ThreadDetail row={row} />
          </Command.Detail>

          <Command.Action
            icon={PencilSimpleIcon}
            id="submit"
            shortcut="Mod+Enter"
            submit
            run={(ctx) => rename(deps, row.id, ctx.query || name)}
          >
            Rename thread
          </Command.Action>
        </Command.Item>
      </Command.Section>
    </Command.Page>
  );
}

function open(deps: ShellCommandDeps, id: string) {
  deps.onOpenChange(false);

  return deps
    .nav({
      to: '/threads/$threadId',
      params: { threadId: id },
    })
    .catch((err: unknown) => {
      console.error('Command palette thread navigation failed.', err);
    });
}

function createThread(deps: ShellCommandDeps, value: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = value.trim() || 'New thread';
  const tx = deps.col.insert({
    id,
    ownerId: deps.user.id,
    title,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });

  deps.onOpenChange(false);

  return deps
    .nav({
      to: '/threads/$threadId',
      params: { threadId: id },
    })
    .then(() => tx.isPersisted.promise)
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error('Command palette thread create failed.', err);
    });
}

function rename(deps: ShellCommandDeps, id: string, value: string) {
  const title = value.trim();

  if (!title) return;

  deps.col.update(id, (draft) => {
    draft.title = title;
    draft.updatedAt = new Date().toISOString();
  });

  deps.onOpenChange(false);
}

function archive(deps: ShellCommandDeps, id: string) {
  const fallback = id === deps.active ? after(deps.threads, id) : null;

  deps.col.update(id, (draft) => {
    draft.archivedAt = new Date().toISOString();
  });

  deps.onOpenChange(false);

  if (id !== deps.active) return;

  if (fallback) {
    return deps
      .nav({
        to: '/threads/$threadId',
        params: { threadId: fallback.id },
        replace: true,
      })
      .catch((err: unknown) => {
        console.error('Command palette archive navigation failed.', err);
      });
  }

  return deps
    .nav({
      to: '/threads',
      replace: true,
    })
    .catch((err: unknown) => {
      console.error('Command palette archive navigation failed.', err);
    });
}

export { threadsModule };
