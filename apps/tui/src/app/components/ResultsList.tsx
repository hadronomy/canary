import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";

import type { Theme } from "~/app/theme";

type ResultItem = {
  title: string;
  summary: string;
};

type ResultsListProps = {
  theme: Theme;
  query: string;
  results: ResultItem[];
  onSelect?: (item: ResultItem) => void;
  active?: boolean;
};

export function ResultsList({ theme, query, results, onSelect, active }: ResultsListProps) {
  const { palette } = theme;
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useKeyboard((key) => {
    if (!active) return;
    if (results.length === 0) return;

    if (key.name === "down") {
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    }

    if (key.name === "up") {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    }

    if (key.name === "enter" || key.name === "return") {
      const selected = results[selectedIndex];
      if (selected && onSelect) {
        onSelect(selected);
      }
    }
  });

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
        results.map((result, index) => {
          const isSelected = index === selectedIndex;
          return (
            <box
              key={result.title}
              style={{
                width: "100%",
                padding: 1,
                marginBottom: 1,
                backgroundColor: isSelected ? palette.surface1 : palette.surface0,
              }}
            >
              <text
                content={result.title}
                style={{
                  fg: isSelected ? palette.mauve : palette.text,
                  attributes: TextAttributes.BOLD,
                }}
              />
              <text
                content={result.summary}
                style={{
                  fg: isSelected ? palette.subtext0 : palette.overlay0,
                  marginTop: 1,
                }}
              />
            </box>
          );
        })
      )}
    </scrollbox>
  );
}
