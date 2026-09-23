import type { LinkSafetyModalProps } from 'streamdown';

import { ArrowUpRightIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';

/**
 * The check before a link in an answer takes you somewhere else.
 *
 * A model can be talked into writing any URL, so a link in a reply is not
 * trusted just because it reads well. What this dialog is for is the host:
 * it gets a line of its own, in the body face above the full address,
 * because that is the one thing worth checking, and a full URL hides a
 * lookalike domain in the middle of a hundred characters. The address sits
 * under it, muted, for anyone who wants the path.
 *
 * It opens on every link click, so it says little and gets out of the way:
 * one clear action, focused on arrival so Enter confirms, and Escape or a
 * click outside to back out. Streamdown renders one of these per link and
 * keeps it mounted while closed, which is what lets the close animate.
 */
function LinkDialog({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const [done, setDone] = useState(false);
  const open = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!done) {
      return;
    }

    const timer = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(timer);
  }, [done]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="gap-4 rounded-(--radius-shell) p-5 sm:max-w-[380px]"
        closeClassName="right-[14px] top-[18px]"
        initialFocus={open}
      >
        {/* Right padding keeps a long title clear of the close button. */}
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle className="text-[14px]/5 font-semibold tracking-[-0.01em]">
            Open this link?
          </DialogTitle>
          <DialogDescription className="text-[13px]/5">
            It opens in a new tab, outside Canary.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-0.5 rounded-(--radius-control) bg-[color-mix(in_oklch,var(--foreground)_5%,transparent)] px-3 py-2.5">
          <span className="truncate text-[13px]/5 font-medium">{host(url)}</span>
          {bare(url) ? null : (
            <span className="line-clamp-2 font-mono text-[11.5px]/[1.5] break-all text-muted-foreground [font-variant-ligatures:none]">
              {url}
            </span>
          )}
        </div>

        <DialogFooter className="gap-1.5">
          {/* The icon trades places with a check in the same slot, and the
              label stays put, so the button never changes width under the
              pointer. */}
          <Button
            className="text-muted-foreground"
            size="lg"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(url).then(
                () => setDone(true),
                () => setDone(false),
              );
            }}
          >
            <span
              aria-hidden
              className="t-icon-swap size-4"
              data-icon="inline-start"
              data-state={done ? 'b' : 'a'}
            >
              <CopyIcon className="t-icon size-4" data-icon="a" />
              <CheckIcon className="t-icon size-4 text-success" data-icon="b" weight="bold" />
            </span>
            Copy link
          </Button>

          <Button
            ref={open}
            size="lg"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Open link
            <ArrowUpRightIcon data-icon="inline-end" weight="bold" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Whether the address says nothing the host does not: `https`, no path, no
 * query. Plain `http` is never bare, since that is worth seeing.
 */
function bare(url: string) {
  if (!URL.canParse(url)) {
    return false;
  }

  const parsed = new URL(url);
  return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash;
}

/** The host, without a `www.` that says nothing about who runs it. */
function host(url: string) {
  if (!URL.canParse(url)) {
    return url;
  }

  return new URL(url).host.replace(/^www\./, '');
}

export { LinkDialog };
