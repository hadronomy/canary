import type { ComponentPropsWithoutRef } from 'react';

import Avvvatars from 'avvvatars-react';

import type { ShellUser } from '~/components/shell/routes';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { cn } from '~/lib/utils';

type UserAvatarProps = Omit<ComponentPropsWithoutRef<typeof Avatar>, 'children'> & {
  user: ShellUser;
};

/**
 * The person, and only the person.
 *
 * It used to carry a status badge driven by whether the local cache was warm.
 * A dot on an avatar means presence to everyone who has used chat software,
 * so it was answering a question nobody asked with information about something
 * else entirely. Sync state is reported in words, next to the name.
 */
function UserAvatar({ className, size, user, ...props }: UserAvatarProps) {
  const seed = user.email ?? user.name ?? user.id;
  const pixels = size === 'lg' ? 40 : size === 'sm' ? 24 : 32;

  return (
    <Avatar className={cn('bg-popover', className)} size={size} {...props}>
      {user.image ? <AvatarImage alt="" src={user.image} /> : null}
      <AvatarFallback className="overflow-hidden bg-transparent p-0">
        <Avvvatars border={false} radius={pixels} size={pixels} style="shape" value={seed} />
      </AvatarFallback>
    </Avatar>
  );
}

export { UserAvatar };
export type { UserAvatarProps };
