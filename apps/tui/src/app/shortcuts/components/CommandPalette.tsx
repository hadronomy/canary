import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";

import type { Theme } from "../../theme";
import { formatKeyCombo } from "../helpers";
import type { Shortcut } from "../types";

export type CommandPaletteProps = {
  theme: Theme;
  open: boolean;
  shortcuts: Shortcut[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (shortcut: Shortcut) => void;
};

export function CommandPalette({
  theme,
  open,
  shortcuts,
  query,
  onQueryChange,
  onSelect,
}: CommandPaletteProps) {
  const { palette } = theme;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return shortcuts;
    const needle = query.trim().toLowerCase();
    return shortcuts.filter((shortcut) =>
      `${shortcut.description} ${shortcut.category ?? ""}`.toLowerCase().includes(needle),
    );
  }, [query, shortcuts]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, Shortcut[]>>((acc, shortcut) => {
      const category = shortcut.category ?? "General";
      acc[category] = acc[category] ? [...acc[category], shortcut] : [shortcut];
      return acc;
    }, {});
  }, [filtered]);

  const sortedCategories = useMemo(() => Object.keys(grouped).sort(), [grouped]);
  const flattened = useMemo(() => filtered, [filtered]);

  useEffect(() => {
    if (!flattened.length) return;
    const exists = flattened.some((item) => item.id === selectedId);
    if (!selectedId || !exists) {
      const first = flattened[0];
      if (first) setSelectedId(first.id);
    }
  }, [flattened, selectedId]);

  useKeyboard((key) => {
    if (!open) return;
    if (!flattened.length) return;

    const currentIndex = flattened.findIndex((item) => item.id === selectedId);
    if (key.name === "down") {
      const next = currentIndex > 0 ? currentIndex - 1 : flattened.length - 1;
      const nextItem = flattened[next];
      if (nextItem) setSelectedId(nextItem.id);
    }
    if (key.name === "up") {
      const next = currentIndex >= 0 ? (currentIndex + 1) % flattened.length : 0;
      const nextItem = flattened[next];
      if (nextItem) setSelectedId(nextItem.id);
    }
    if (key.name === "enter" || key.name === "return") {
      const selected = flattened.find((item) => item.id === selectedId);
      if (selected) onSelect(selected);
    }
  });

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
        zIndex: 40,
      }}
    >
      <box
        style={{
          width: "50%",
          height: "80%",
          border: true,
          borderStyle: "rounded",
          borderColor: palette.mauve,
          backgroundColor: palette.base,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          flexDirection: "column",
          gap: 1,
        }}
      >
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
            placeholder="Search actions..."
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
              {(grouped[category] ?? []).map((shortcut) => {
                const isSelected = shortcut.id === selectedId;
                return (
                  <box
                    key={shortcut.id}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      width: "100%",
                      height: 1,
                      paddingRight: 2,
                      backgroundColor: isSelected ? palette.surface1 : "transparent",
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
                );
              })}
            </box>
          ))}
        </scrollbox>
        <text
          content="Type to filter · Enter to run · Esc to close"
          style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
        />
      </box>
    </box>
  );
}
