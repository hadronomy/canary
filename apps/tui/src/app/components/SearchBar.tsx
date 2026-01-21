import type { TextareaRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";

import type { Theme } from "~/app/theme";

type SearchBarProps = {
  theme: Theme;
  query: string;
  inputId?: string;
  onQueryChange: (value: string) => void;
  focused: boolean;
};

export function SearchBar({ theme, query, onQueryChange, focused, inputId }: SearchBarProps) {
  const { palette } = theme;
  const inputRef = useRef<TextareaRenderable | null>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    if (inputRef.current.plainText !== query) {
      inputRef.current.setText(query);
      inputRef.current.gotoLineEnd();
    }
  }, [query]);

  return (
    <box
      style={{
        width: "72%",
        height: 3,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: palette.surface0,
        borderStyle: "heavy",
        border: ["left"],
        borderColor: palette.surface2,
      }}
    >
      <text content=">" style={{ fg: palette.mauve, marginRight: 1, height: 1 }} />
      <textarea
        id={inputId}
        placeholder="Search regulations..."
        ref={(instance: TextareaRenderable) => {
          inputRef.current = instance;
        }}
        initialValue={query}
        onContentChange={() => {
          if (!inputRef.current) return;
          onQueryChange(inputRef.current.plainText);
        }}
        focused={focused}
        height={1}
        style={{
          flexGrow: 1,
          height: 1,
          focusedBackgroundColor: palette.surface0,
          textColor: palette.text,
          selectionBg: palette.surface2,
          selectionFg: palette.text,
        }}
      />
    </box>
  );
}
