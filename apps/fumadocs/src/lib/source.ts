import type { MetaData, PageData, Source } from 'fumadocs-core/source';
import type { DocData, DocMethods } from 'fumadocs-mdx/runtime/types';

import { BuildingIcon } from '@phosphor-icons/react/ssr';
import { type InferPageType, loader } from 'fumadocs-core/source';
import { docs } from 'fumadocs-mdx:collections/server';
import { createElement } from 'react';

type Data = DocData &
  DocMethods &
  PageData & {
    title: string;
    full?: boolean;
  };

const tree = docs.toFumadocsSource() as Source<{
  pageData: Data;
  metaData: MetaData;
}>;

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: '/docs',
  source: tree,
  icon: (icon) =>
    icon === 'Building'
      ? createElement(BuildingIcon, {
          size: 16,
          weight: 'regular',
        })
      : undefined,
});

export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  };
}

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title}

${processed}`;
}
