import { TextAttributes } from "@opentui/core";
import type { Theme } from "../../theme";
import type { Shortcut } from "../types";
import { formatKeyCombo } from "../helpers";

type ShortcutsHelpProps = {
  theme: Theme;
  open: boolean;
  shortcuts: Shortcut[];
  onClose: () => void;
};

export function ShortcutsHelp({ theme, open, shortcuts, onClose }: ShortcutsHelpProps) {
  const { palette } = theme;

  if (!open) {
    return null;
  }

  const grouped = shortcuts.reduce<Record<string, Shortcut[]>>((acc, shortcut) => {
    const category = shortcut.category ?? "General";
    acc[category] = acc[category] ? [...acc[category], shortcut] : [shortcut];
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort();

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
        zIndex: 30,
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
        <scrollbox
          style={{
            flexGrow: 1,
            rootOptions: { backgroundColor: palette.base },
            wrapperOptions: { backgroundColor: palette.base },
            viewportOptions: { backgroundColor: palette.base },
            contentOptions: { backgroundColor: palette.base, flexDirection: "column" },
            scrollbarOptions: {
              showArrows: false,
              trackOptions: {
                foregroundColor: palette.lavender,
                backgroundColor: palette.surface0,
              },
            },
          }}
        >
          {sortedCategories.map((category) => (
            <box
              key={category}
              style={{
                flexDirection: "column",
                width: "100%",
                marginBottom: 1,
              }}
            >
              <text
                content={category.toUpperCase()}
                style={{
                  fg: palette.overlay0,
                  attributes: TextAttributes.BOLD,
                  marginBottom: 0,
                }}
              />
              {(grouped[category] ?? []).map((shortcut) => (
                <box
                  key={shortcut.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    width: "100%",
                    height: 1,
                    paddingRight: 2,
                  }}
                >
                  <text content={shortcut.description} style={{ fg: palette.text }} />
                  {shortcut.bindings.length ? (
                    <text
                      content={shortcut.bindings.map(formatKeyCombo).join(" ")}
                      style={{ fg: palette.lavender }}
                    />
                  ) : null}
                </box>
              ))}
            </box>
          ))}
        </scrollbox>
        <text
          content="Esc to close"
          style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
        />
      </box>
    </box>
  );
}
