'use client';
import {
  ArrowSquareOutIcon,
  BrainIcon,
  CaretDownIcon,
  ChatCircleIcon,
  CheckIcon,
  CopyIcon,
  GithubLogoIcon,
  OpenAiLogoIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from 'fumadocs-ui/components/ui/popover';
import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button';
import { useMemo, useState } from 'react';

import { cn } from '~/lib/cn';

const cache = new Map<string, string>();
const tone = { weight: 'duotone' } as const;

export function LLMCopyButton({
  /**
   * A URL to fetch the raw Markdown/MDX content of page
   */
  markdownUrl,
}: {
  markdownUrl: string;
}) {
  const [isLoading, setLoading] = useState(false);
  const [checked, onClick] = useCopyButton(async () => {
    const cached = cache.get(markdownUrl);
    if (cached) return navigator.clipboard.writeText(cached);

    setLoading(true);

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': fetch(markdownUrl).then(async (res) => {
            const content = await res.text();
            cache.set(markdownUrl, content);

            return content;
          }),
        }),
      ]);
    } finally {
      setLoading(false);
    }
  });

  return (
    <button
      disabled={isLoading}
      className={cn(
        buttonVariants({
          color: 'secondary',
          size: 'sm',
          className: 'gap-2 [&_svg]:size-3.5 [&_svg]:text-fd-muted-foreground',
        }),
      )}
      onClick={onClick}
    >
      {checked ? <CheckIcon {...tone} /> : <CopyIcon {...tone} />}
      Copy Markdown
    </button>
  );
}

export function ViewOptions({
  markdownUrl,
  githubUrl,
}: {
  /**
   * A URL to the raw Markdown/MDX content of page
   */
  markdownUrl: string;

  /**
   * Source file URL on GitHub
   */
  githubUrl: string;
}) {
  const items = useMemo(() => {
    const fullMarkdownUrl =
      typeof window !== 'undefined' ? new URL(markdownUrl, window.location.origin) : 'loading';
    const q = `Read ${fullMarkdownUrl}, I want to ask questions about it.`;

    return [
      {
        title: 'Open in GitHub',
        href: githubUrl,
        icon: <GithubLogoIcon {...tone} />,
      },
      {
        title: 'Open in Scira AI',
        href: `https://scira.ai/?${new URLSearchParams({
          q,
        })}`,
        icon: <SparkleIcon {...tone} />,
      },
      {
        title: 'Open in ChatGPT',
        href: `https://chatgpt.com/?${new URLSearchParams({
          hints: 'search',
          q,
        })}`,
        icon: <OpenAiLogoIcon {...tone} />,
      },
      {
        title: 'Open in Claude',
        href: `https://claude.ai/new?${new URLSearchParams({
          q,
        })}`,
        icon: <BrainIcon {...tone} />,
      },
      {
        title: 'Open in T3 Chat',
        href: `https://t3.chat/new?${new URLSearchParams({
          q,
        })}`,
        icon: <ChatCircleIcon {...tone} />,
      },
    ];
  }, [githubUrl, markdownUrl]);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({
            color: 'secondary',
            size: 'sm',
            className: 'gap-2',
          }),
        )}
      >
        Open
        <CaretDownIcon className="size-3.5 text-fd-muted-foreground" {...tone} />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            rel="noreferrer noopener"
            target="_blank"
            className="text-sm p-2 rounded-lg inline-flex items-center gap-2 hover:text-fd-accent-foreground hover:bg-fd-accent [&_svg]:size-4"
          >
            {item.icon}
            {item.title}
            <ArrowSquareOutIcon className="text-fd-muted-foreground size-3.5 ms-auto" {...tone} />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
