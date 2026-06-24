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
      className={cn(
        'border border-white/10 bg-black/30 shadow-[0_8px_24px_oklch(0_0_0_/_30%)] after:border-white/10',
        props.className,
      )}
      size={props.size}
    >
      {props.user.image ? <AvatarImage alt="" src={props.user.image} /> : null}
      <AvatarFallback className="overflow-hidden bg-transparent p-0">
        <Avvvatars
          border
          borderColor="oklch(1 0 0 / 14%)"
          borderSize={1}
          radius={size}
          shadow={false}
          size={size}
          style="shape"
          value={seed}
        />
      </AvatarFallback>
      {props.ready ? (
        <AvatarBadge className="border border-black/70 bg-[var(--canary-success)] text-transparent ring-2 ring-[var(--canary-panel)]" />
      ) : null}
    </Avatar>
  );
}

export { UserAvatar };
