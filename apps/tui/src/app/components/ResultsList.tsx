import { TextAttributes } from "@opentui/core";
import type { Theme } from "../theme";

type ResultItem = {
  title: string;
  summary: string;
};

type ResultsListProps = {
  theme: Theme;
  query: string;
  results: ResultItem[];
};

export function ResultsList({ theme, query, results }: ResultsListProps) {
  const { palette } = theme;

  return (
    <scrollbox
      style={{
        width: "72%",
        flexGrow: 1,
        rootOptions: {
          backgroundColor: palette.base,
        },
        wrapperOptions: {
          backgroundColor: palette.base,
        },
        viewportOptions: {
          backgroundColor: palette.base,
        },
        contentOptions: {
          backgroundColor: palette.base,
          flexDirection: "column",
        },
        scrollbarOptions: {
          showArrows: false,
          trackOptions: {
            foregroundColor: palette.mauve,
            backgroundColor: palette.surface0,
          },
        },
      }}
    >
      {results.length === 0 ? (
        <box
          style={{
            padding: 1,
            backgroundColor: palette.surface0,
          }}
        >
          <text content={`No results for "${query}" yet.`} style={{ fg: palette.subtext0 }} />
          <text
            content="Start typing to see matches appear instantly."
            style={{ fg: palette.overlay0, marginTop: 1 }}
          />
        </box>
      ) : (
        results.map((result) => (
          <box
            key={result.title}
            style={{
              width: "100%",
              padding: 1,
              marginBottom: 1,
              backgroundColor: palette.surface0,
            }}
          >
            <text
              content={result.title}
              style={{ fg: palette.text, attributes: TextAttributes.BOLD }}
            />
            <text content={result.summary} style={{ fg: palette.overlay0, marginTop: 1 }} />
          </box>
        ))
      )}
    </scrollbox>
  );
}
