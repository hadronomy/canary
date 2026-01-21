import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";

import type { Theme } from "~/app/theme";

type CommandOption = {
  name: string;
  description: string;
  value: string;
};

type CmdkMenuProps = {
  theme: Theme;
  open: boolean;
  query: string;
  options: CommandOption[];
  onQueryChange: (value: string) => void;
};

export function CmdkMenu({ theme, open, query, options, onQueryChange }: CmdkMenuProps) {
  const { palette } = theme;
  const inputRef = useRef<TextareaRenderable | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!inputRef.current) return;
    if (inputRef.current.plainText !== query) {
      inputRef.current.setText(query);
      inputRef.current.gotoLineEnd();
    }
  }, [open, query]);

  if (!open) {
    return null;
  }

  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 20,
      }}
    >
      <box
        style={{
          width: "60%",
          height: "60%",
          border: true,
          borderStyle: "rounded",
          borderColor: palette.mauve,
          backgroundColor: palette.base,
          padding: 1,
          flexDirection: "column",
        }}
      >
        <box
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingLeft: 1,
            paddingRight: 1,
            marginBottom: 1,
          }}
        >
          <text
            content="Command Palette"
            style={{ fg: palette.text, attributes: TextAttributes.BOLD }}
          />
          <text content="esc" style={{ fg: palette.subtext0 }} />
        </box>

        <box
          style={{
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
            marginBottom: 1,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <textarea
            placeholder="Type a command..."
            initialValue={query}
            onContentChange={() => {
              if (!inputRef.current) return;
              onQueryChange(inputRef.current.plainText);
            }}
            ref={(instance: TextareaRenderable) => {
              inputRef.current = instance;
            }}
            focused
            height={1}
            style={{
              flexGrow: 1,
              height: 1,
              focusedBackgroundColor: palette.base,
              cursorColor: palette.mauve,
              textColor: palette.text,
              selectionBg: palette.surface2,
              selectionFg: palette.text,
            }}
          />
        </box>

        <select
          focused={false}
          showScrollIndicator
          options={options}
          style={{
            flexGrow: 1,
            backgroundColor: "transparent",
            textColor: palette.text,
            descriptionColor: palette.subtext0,
            focusedBackgroundColor: palette.surface1,
            focusedTextColor: palette.mauve,
            selectedBackgroundColor: palette.surface1,
            selectedTextColor: palette.mauve,
            selectedDescriptionColor: palette.subtext0,
          }}
        />

        <box
          style={{
            marginTop: 1,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: "row",
            gap: 2,
          }}
        >
          <text
            content="↑/↓ to navigate"
            style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
          />
          <text
            content="Enter to run"
            style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
          />
        </box>
      </box>
    </box>
  );
}
