import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2">
          <span className="font-bold text-xl tracking-tight text-grainy-gradient font-sans lowercase">
            canary
          </span>
        </div>
      ),
      transparentMode: 'top',
    },
    links: [{ text: 'Guide', url: '/docs', active: 'nested-url' }],
    githubUrl: 'https://github.com/hadronomy/canary',
  };
}
