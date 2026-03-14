import { renderMermaidSVG } from 'beautiful-mermaid';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';

export async function Mermaid({ chart }: { chart: string }) {
  try {
    const svg = renderMermaidSVG(chart, {
      bg: 'var(--background)',
      fg: 'var(--foreground)',
      accent: 'var(--primary)',
      muted: 'var(--foreground-muted)',
      interactive: true,
      transparent: true,
    });

    return <div dangerouslySetInnerHTML={{ __html: svg }} />;
  } catch (err: any) {
    return (
      <CodeBlock title="Mermaid">
        <Pre>{`An error occurred while rendering the Mermaid chart. ${err.message || 'Unknown error'}`}</Pre>
      </CodeBlock>
    );
  }
}
