import { TextAttributes } from "@opentui/core";
import type { Theme } from "~/app/theme";

type BrandingProps = {
  theme: Theme;
};

export function Branding({ theme }: BrandingProps) {
  const { palette } = theme;

  return (
    <box style={{ alignItems: "center" }}>
      <ascii-font font="tiny" text="Canary" style={{ color: palette.mauve }} />
      <text
        content="What will you search?"
        style={{
          fg: palette.subtext0,
          attributes: TextAttributes.DIM,
          marginTop: 1,
        }}
      />
    </box>
  );
}
