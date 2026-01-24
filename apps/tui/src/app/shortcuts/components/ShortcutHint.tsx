import { TextAttributes } from "@opentui/core";

import { formatKeyCombo } from "~/app/shortcuts/helpers";
import type { KeyCombo } from "~/app/shortcuts/types";
import type { Theme } from "~/app/theme";

type ShortcutHintProps = {
  theme: Theme;
  bindings: KeyCombo[];
  label: string;
};

export function ShortcutHint({ theme, bindings, label }: ShortcutHintProps) {
  const { palette } = theme;
  const bindingText = bindings.map(formatKeyCombo).join(" / ");

  return (
    <box style={{ flexDirection: "row", gap: 1 }}>
      <text content={bindingText} style={{ fg: palette.mauve, attributes: TextAttributes.DIM }} />
      <text content={label} style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }} />
    </box>
  );
}
