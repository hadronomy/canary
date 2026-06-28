import type { ComponentPropsWithoutRef } from 'react';

import Avvvatars from 'avvvatars-react';

import type { ShellUser } from '~/components/shell/routes';

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { cn } from '~/lib/utils';

type UserAvatarProps = Omit<ComponentPropsWithoutRef<typeof Avatar>, 'children'> & {
  ready?: boolean;
  user: ShellUser;
};

function UserAvatar({ className, ready, size, user, ...props }: UserAvatarProps) {
  const seed = user.email ?? user.name ?? user.id;
  const pixels = size === 'lg' ? 40 : size === 'sm' ? 24 : 32;

  return (
    <Avatar
      className={cn('border border-border bg-popover after:border-border', className)}
      size={size}
      {...props}
    >
      {user.image ? <AvatarImage alt="" src={user.image} /> : null}
      <AvatarFallback className="overflow-hidden bg-transparent p-0">
        <Avvvatars
          borderColor="var(--input)"
          borderSize={1}
          radius={pixels}
          size={pixels}
          style="shape"
          value={seed}
        />
      </AvatarFallback>
      {ready ? (
        <AvatarBadge className="border border-background/70 bg-primary text-transparent ring-2 ring-card" />
      ) : null}
    </Avatar>
  );
}

export { UserAvatar };
export type { UserAvatarProps };
