import { Dithering } from '@paper-design/shaders-react';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-col items-center w-full min-h-screen bg-background">
      {/* Main Structural Wrapper */}
      <div className="w-full max-w-7xl mx-auto border-x border-border relative">
        {/* HERO SECTION */}
        <section className="wrapper--ticks grid md:grid-cols-2 md:divide-x divide-border border-b border-border relative">
          {/* Top Edge Ticks */}
          <span className="tick-left absolute top-0 left-0" />
          <span className="tick-right absolute top-0 right-0" />

          <div className="flex flex-col justify-between p-8 md:p-12 lg:p-16 gap-16 md:gap-20">
            <div className="flex flex-col items-start text-center md:text-left">
              <div className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground mb-6 flex items-center gap-2 mx-auto md:mx-0">
                By <span className="font-bold text-foreground">HADRONOMY</span>
              </div>

              <h1 className="text-4xl lg:text-[3rem] tracking-tight text-foreground text-pretty leading-[1.1] mb-6 mx-auto md:mx-0">
                The Agentic Legal Assistant
              </h1>

              <p className="text-lg text-muted-foreground max-w-md mb-10 leading-relaxed text-pretty mx-auto md:mx-0">
                Canary is a blazing fast, highly secure AI reasoning engine powering the next
                generation of legal drafting and research.
              </p>

              <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 w-full">
                <Link href="/docs" className="btn-primary">
                  Get Started
                </Link>
                <Link
                  href="https://github.com/hadronomy/canary"
                  target="_blank"
                  className="btn-secondary"
                >
                  View on GitHub
                </Link>
              </div>

              <div className="hidden md:flex flex-col items-start text-center md:text-left gap-4 mt-10 mx-auto md:mx-0">
                <ServerCodeBlock
                  codeblock={{
                    className: 'max-w-md w-100 pl-2',
                  }}
                  code="bunx canary@latest --help"
                  lang="bash"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center relative min-h-100">
            <div className="h-full w-full mask-[linear-gradient(to_bottom,transparent,black_80%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_80%)] md:mask-none md:[-webkit-mask-image:none]">
              <Dithering
                className="h-full w-full"
                colorBack="#00000000"
                colorFront="#00ffd9a8"
                shape="warp"
                type="4x4"
                size={2}
                speed={0.6}
                scale={0.6}
              />
            </div>
          </div>
        </section>

        {/* HEADING SECTION */}
        <section className="wrapper--ticks border-b border-border px-6 py-16 md:py-24 flex flex-col justify-center gap-4 text-center items-center bg-card/5 relative">
          <h2 className="text-3xl md:text-5xl font-medium max-w-3xl text-foreground text-center text-balance">
            Redefining legal workflows
          </h2>
          <p className="max-w-lg text-muted-foreground text-lg text-balance">
            Canary makes complex document analysis and autonomous drafting enjoyable again.
          </p>
        </section>

        {/* FEATURE GRID 1 */}
        <section className="wrapper--ticks grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border border-b border-border relative">
          <div className="flex flex-col justify-between border-b lg:border-b-0 border-border group hover:bg-secondary/10 transition-colors">
            <div className="p-8 md:p-12 flex flex-col gap-4">
              <h5 className="text-xl font-semibold text-foreground">Instant Context Parsing</h5>
              <p className="text-muted-foreground max-w-md leading-relaxed text-pretty text-[15px]">
                Ingest hundreds of pages of contracts and case law instantly. On-demand semantic
                search powered by native vector DB integration.
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between group hover:bg-secondary/10 transition-colors">
            <div className="p-8 md:p-12 flex flex-col gap-4">
              <h5 className="text-xl font-semibold text-foreground">Agentic Drafting</h5>
              <p className="text-muted-foreground max-w-md leading-relaxed text-pretty text-[15px]">
                Canary autonomously drafts complex clauses and emails based on your firm's precedent
                library and tone of voice.
              </p>
            </div>
          </div>
        </section>

        {/* BOTTOM CTA */}
        <section className="wrapper--ticks py-20 flex flex-col justify-center gap-6 text-center items-center relative">
          <h2 className="text-3xl font-bold text-foreground">Start building with Canary</h2>
          <p className="max-w-md text-muted-foreground text-pretty">
            Prepare for a legal analysis environment that can finally keep pace with the speed of
            your mind.
          </p>
          <Link href="/docs" className="btn-primary mt-4">
            Get Started
          </Link>
        </section>
      </div>
    </main>
  );
}
