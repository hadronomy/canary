import { TextAttributes } from "@opentui/core";
import type { Theme } from "../theme";

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
          height: 14,
          border: true,
          borderStyle: "rounded",
          borderColor: palette.mauve,
          backgroundColor: palette.base,
          padding: 1,
          flexDirection: "column",
          gap: 1,
        }}
      >
        <text
          content="Command Palette"
          style={{ fg: palette.text, attributes: TextAttributes.BOLD }}
        />

        <box
          style={{
            height: 3,
            border: true,
            borderStyle: "rounded",
            borderColor: palette.surface2,
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 0,
            paddingBottom: 0,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: palette.base,
          }}
        >
          <text content=">" style={{ fg: palette.mauve, marginRight: 1, height: 1 }} />
          <input
            placeholder="Type a command..."
            onInput={onQueryChange}
            focused
            style={{
              flexGrow: 1,
              height: 1,
              focusedBackgroundColor: palette.base,
              placeholderColor: palette.overlay0,
              textColor: palette.text,
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
            focusedBackgroundColor: palette.surface0,
            focusedTextColor: palette.blue,
            selectedBackgroundColor: palette.surface1,
            selectedTextColor: palette.mauve,
            selectedDescriptionColor: palette.lavender,
          }}
        />

        <text
          content="Enter to run · Esc to close"
          style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
        />
      </box>
    </box>
  );
}
