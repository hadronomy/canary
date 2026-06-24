import Avvvatars from 'avvvatars-react';

import type { ShellUser } from '~/components/shell/model';

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { cn } from '~/lib/utils';

function UserAvatar(props: {
  className?: string;
  ready?: boolean;
  size?: 'default' | 'lg';
  user: ShellUser;
}) {
  const seed = props.user.email ?? props.user.name ?? props.user.id;
  const size = props.size === 'lg' ? 40 : 32;

  return (
    <Avatar
      className={cn('border border-line bg-surface-raised after:border-line', props.className)}
      size={props.size}
    >
      {props.user.image ? <AvatarImage alt="" src={props.user.image} /> : null}
      <AvatarFallback className="overflow-hidden bg-transparent p-0">
        <Avvvatars
          borderColor="var(--canary-line-strong)"
          borderSize={1}
          radius={size}
          size={size}
          style="shape"
          value={seed}
        />
      </AvatarFallback>
      {props.ready ? (
        <AvatarBadge className="border border-background/70 bg-success text-transparent ring-2 ring-surface" />
      ) : null}
    </Avatar>
  );
}

export { UserAvatar };
