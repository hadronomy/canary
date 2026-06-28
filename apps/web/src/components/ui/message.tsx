import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '~/lib/utils';

type MessageGroupProps = ComponentPropsWithoutRef<'div'>;

function MessageGroup({ className, ...props }: MessageGroupProps) {
  return (
    <div
      data-slot="message-group"
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      {...props}
    />
  );
}

type MessageProps = ComponentPropsWithoutRef<'div'> & {
  align?: 'start' | 'end';
};

function Message({ className, align = 'start', ...props }: MessageProps) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        'group/message relative flex w-full min-w-0 gap-1.5 text-xs data-[align=end]:flex-row-reverse',
        className,
      )}
      {...props}
    />
  );
}

type MessageAvatarProps = ComponentPropsWithoutRef<'div'>;

function MessageAvatar({ className, ...props }: MessageAvatarProps) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        'flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted group-has-data-[slot=message-footer]/message:-translate-y-8',
        className,
      )}
      {...props}
    />
  );
}

type MessageContentProps = ComponentPropsWithoutRef<'div'>;

function MessageContent({ className, ...props }: MessageContentProps) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        'flex w-full min-w-0 flex-col gap-2 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end',
        className,
      )}
      {...props}
    />
  );
}

type MessageHeaderProps = ComponentPropsWithoutRef<'div'>;

function MessageHeader({ className, ...props }: MessageHeaderProps) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        'flex max-w-full min-w-0 items-center px-2.5 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0',
        className,
      )}
      {...props}
    />
  );
}

type MessageFooterProps = ComponentPropsWithoutRef<'div'>;

function MessageFooter({ className, ...props }: MessageFooterProps) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        'flex max-w-full min-w-0 items-center px-2.5 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export { MessageGroup, Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader };
export type {
  MessageGroupProps,
  MessageProps,
  MessageAvatarProps,
  MessageContentProps,
  MessageFooterProps,
  MessageHeaderProps,
};
