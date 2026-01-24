import { TextAttributes } from "@opentui/core";

import type { Theme } from "~/app/theme";

type FooterHintsProps = {
  theme: Theme;
};

export function FooterHints({ theme }: FooterHintsProps) {
  const { palette } = theme;

  return (
    <box
      style={{
        paddingLeft: 2,
        paddingBottom: 1,
        flexDirection: "row",
        gap: 2,
      }}
    >
      <text content="Ctrl+K" style={{ fg: palette.mauve, attributes: TextAttributes.DIM }} />
      <text
        content="Command menu"
        style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
      />
      <text content="Esc" style={{ fg: palette.mauve, attributes: TextAttributes.DIM }} />
      <text content="Clear" style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }} />
    </box>
  );
}
