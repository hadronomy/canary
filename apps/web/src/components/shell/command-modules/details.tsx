import type { ThreadRecord } from '~/components/shell/command-modules/types';
import type { ShellUser } from '~/components/shell/routes';

import { CommandCard } from '~/components/command-palette';
import { stamp } from '~/components/shell/command-modules/utils';

function AccountDetail(props: { user: ShellUser }) {
  return (
    <div className="grid gap-2">
      <CommandCard
        label="Account"
        title={props.user.name ?? 'Canary user'}
        value={props.user.email ?? 'Local session'}
      />
      <CommandCard label="Sync" title="Realtime sync" value="Electric local cache" />
    </div>
  );
}

function ThreadDetail(props: { row: ThreadRecord }) {
  return (
    <div className="grid gap-2">
      <CommandCard
        label="Thread"
        title={props.row.title.trim() || 'Untitled thread'}
        value={props.row.id}
      />
      <CommandCard label="Updated" title={stamp(props.row.updatedAt)} value={props.row.updatedAt} />
      <CommandCard label="Created" title={stamp(props.row.createdAt)} value={props.row.createdAt} />
    </div>
  );
}

export { AccountDetail, ThreadDetail };
