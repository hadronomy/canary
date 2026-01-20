import { TextAttributes } from "@opentui/core";
import type { Theme } from "~/app/theme";

type ShortcutDebugToastProps = {
  theme: Theme;
  open: boolean;
  message: string;
};

export function ShortcutDebugToast({ theme, open, message }: ShortcutDebugToastProps) {
  if (!open) return null;

  return (
    <box
      style={{
        position: "absolute",
        right: 2,
        bottom: 2,
        border: true,
        borderStyle: "heavy",
        borderColor: theme.palette.mauve,
        backgroundColor: theme.palette.base,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        zIndex: 50,
      }}
    >
      <text content={message} style={{ fg: theme.palette.text, attributes: TextAttributes.DIM }} />
    </box>
  );
}
